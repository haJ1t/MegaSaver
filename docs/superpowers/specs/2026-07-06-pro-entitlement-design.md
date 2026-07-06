---
title: Pro entitlement seam + first premium module (historical savings analytics)
date: 2026-07-06
status: proposed
risk: CRITICAL
scope: offline Ed25519 license + checkEntitlement seam + mega license + a proprietary pro-analytics module + gated mega savings history/export
base: main (d72c97cc)
reviewers: [code-reviewer, critic, security-reviewer]
manual-confirmation: REQUIRED (licensing/permission code — §12 CRITICAL). User approves this spec before any build.
---

# Pro entitlement + historical savings analytics

## Motivation

Open-core monetization (user-approved 2026-07-06): the CLI core stays MIT/free;
Pro unlocks NEW features that were never shipped free, gated by an offline
license. This lays the entitlement infrastructure + the first Pro module.

## Locked decisions (user-approved 2026-07-06)

1. **Entitlement seam + one new premium module** (not cloud, not scaffold-only).
2. **First module: historical savings analytics + export** — time-series trends,
   per-project breakdown, CSV/JSON export. (Free tier already shows the *current*
   cumulative total; history/trends/export are new.)
3. **Offline Ed25519-signed license**, `mega license` command, a proprietary
   (non-MIT) premium package in the monorepo. Billing (Stripe) deferred — keys are
   issued manually via vendor tooling until launch proves demand.

## Honesty disclosure (must be in the product + docs)

The entitlement GATE is in MIT/OSS code, so it is technically bypassable by
editing the source — this is inherent to open-core and we do not pretend
otherwise. What is NOT forgeable is the license itself: keys are Ed25519-signed
by a private key held offline by the vendor, verified against a public key baked
into the CLI. Honest users pay for a real key (the Sublime/Obsidian model); the
signature makes fake keys impossible; the gate makes piracy a deliberate license
violation. We state this plainly rather than security-theater.

## Design

### 1. Entitlement seam — `@megasaver/entitlement` (new, MIT)

- `checkEntitlement(feature: ProFeature, deps: { storeRoot; now: () => number }): EntitlementResult`
  where `EntitlementResult = { entitled: true; tier: "pro"; expiresAt: string | null }
  | { entitled: false; reason: "no_license" | "expired" | "invalid_signature" | "malformed" }`.
  **Fail-closed**: anything unverifiable → `entitled:false`.
- **License key format** (compact, offline-verifiable): `msp_<b64url(payload)>.<b64url(sig)>`
  where `payload` = JSON `{ v:1, tier:"pro", id:string, iat:number, exp:number|null }`
  and `sig` = Ed25519 signature over the exact `payload` bytes.
- **Verification** (`node:crypto`): `crypto.verify(null, payloadBytes, publicKey, sig)`
  against the baked-in Ed25519 **public key** (a constant in the package). Then
  check `tier` and `exp` (if set) against `now`. No network — fully offline.
- **Storage**: `<storeRoot>/license.json` = `{ key: string, activatedAt: string }`.
  `activateLicense(storeRoot, key)` verifies BEFORE storing (reject invalid keys
  at activation, not just at check); `readLicense`, `deactivateLicense`,
  `licenseStatus`.
- The **private key is NEVER in the repo**. The baked public key is the vendor's
  real public key (placeholder committed with a clear TODO until the owner runs
  the keygen tool and pastes their public key). Tests use a **test keypair**
  generated in-test (the test's private key signs test licenses; never shipped).

### 2. Vendor tooling — `scripts/license/` (not shipped, private key gitignored)

- `gen-keypair.mjs` — generates an Ed25519 keypair; prints the public key to bake
  in; writes the private key to a gitignored file the owner keeps offline.
- `issue.mjs <id> [--exp <iso>] [--priv <path>]` — signs a license with the
  private key → prints the `msp_…` key. (Manual issuance until Stripe.)
- `.gitignore`: the private key path.

### 3. Proprietary premium module — `packages/pro-analytics` (NON-MIT)

- A `LICENSE` file: proprietary — "© 2026 Halit Ozger. Source-available. Use
  requires a valid Mega Saver Pro license; not licensed for use otherwise."
  `package.json` `"license": "SEE LICENSE IN LICENSE"`, `"private": true`.
- Pure functions (no fs; the CLI reads events and passes them in):
  - `computeSavingsHistory(events, { bucket: "day" | "week" }): HistoryPoint[]`
    — bucket `TokenSaverEvent`s by `createdAt`, sum bytesSaved → tokens/$ per bucket
    (reuse `tokensFromBytes` + `formatDollarsSaved` from `@megasaver/stats` for
    consistency with the free headline).
  - `computeSavingsByProject(eventsByProject): ProjectRow[]` — per-project totals.
  - `exportSavings(rows, format: "csv" | "json"): string` — CSV (escaped) or JSON.
- MIT `@megasaver/stats` may depend on nothing here; `pro-analytics` depends on
  `@megasaver/stats` (one-way, no cycle). The MIT core never imports pro-analytics.

### 4. Gated CLI — `apps/cli`

- `mega license activate <key>` / `status` / `deactivate` (calls the seam).
- `mega savings history [--by day|week|project] [--window session|week|all] [--json|--csv]`
  and `mega savings export --format csv|json [--out <file>]`:
  1. `checkEntitlement("savings-analytics", …)`.
  2. **Not entitled** → an honest upsell (exit 0, not an error):
     `Historical savings analytics is a Mega Saver Pro feature. Activate a key:
     mega license activate <key>. Learn more: <url>.` Nothing computed.
  3. **Entitled** → read the events (existing `readEvents`), call the
     `pro-analytics` computation, render (table / --json / --csv / --out file).
- The gated commands import `pro-analytics` lazily (dynamic import) so a user with
  no Pro license still has a fully-working free CLI even if pro-analytics is absent
  from a slimmed build (defensive; also keeps the free bundle honest).

## Security (CRITICAL — the security-reviewer's targets)

- Ed25519 verify is correct + **fail-closed**: tampered payload, wrong key, absent
  key, malformed token, expired → all `entitled:false`. A forged/edited license
  must NEVER verify.
- `activateLicense` rejects an invalid key (doesn't store junk).
- The **private key is never committed**; grep the repo — only a public key + a
  gitignored private path. The test keypair's private key lives only in the test.
- No network calls (offline). No telemetry. The license id is not a secret but is
  not logged beyond `license status`.
- Verifier reproduction: generate a key with a test private key → activate →
  gated feature works; edit one byte of the key → rejected; expire → rejected; no
  license → upsell.

## Non-goals (deferred)

Stripe/billing + automated key delivery; a licensing server / online activation;
seat/team licenses; the other premium modules; hardware-binding / anti-piracy
beyond the signature; refund/revocation lists.

## Testing (TDD)

- **entitlement**: verify a valid test-signed key → entitled; tampered byte →
  invalid_signature; expired → expired; absent → no_license; malformed → malformed.
  activate stores only valid keys. Round-trip: issue (test priv) → activate →
  checkEntitlement true.
- **pro-analytics**: history buckets events by day/week with correct sums (reuse
  tokensFromBytes); by-project rows; CSV escaping + JSON shape; empty → empty.
- **CLI**: no license → `mega savings history` prints the upsell, computes
  nothing, exit 0; with a valid test license → prints the history / --csv / --json;
  `mega license activate <valid>` → status shows pro; `activate <forged>` → rejected.
- `pnpm verify` green; a real end-to-end smoke with a test keypair.

## Slices

- **A**: `@megasaver/entitlement` (Ed25519 verify + storage + activate/status) +
  `mega license` command + vendor keygen/issue tooling + test keypair. (Security-critical.)
- **B**: `packages/pro-analytics` (proprietary) — history/by-project/export pure fns.
- **C**: gated `mega savings history` / `export` (checkEntitlement → upsell or
  pro-analytics) + docs (README Pro section + the honesty disclosure) + changeset.
