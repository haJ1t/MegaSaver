# Pro entitlement + historical savings analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD. Build after src edits. `pnpm verify` at slice boundaries. This is CRITICAL (licensing) — fail-closed everywhere, tests cover forgery/tamper/expiry.

**Goal:** Open-core entitlement: an offline Ed25519 license gates NEW Pro features. First module = historical savings analytics + export. Free CLI stays fully functional without a license.

**Architecture:** `@megasaver/entitlement` (MIT, fail-closed `checkEntitlement` + Ed25519 verify + license storage + `mega license`); `packages/pro-analytics` (proprietary, pure history/export fns); gated `mega savings history/export` that upsells when not entitled. Private key never in the repo; tests use a test keypair.

**Tech Stack:** TypeScript ESM, `node:crypto` (Ed25519), Vitest, Citty. Packages: `@megasaver/entitlement` (new), `packages/pro-analytics` (new), `@megasaver/stats`, `apps/cli`.

**Spec:** `docs/superpowers/specs/2026-07-06-pro-entitlement-design.md`. Risk CRITICAL → code-reviewer + critic + security-reviewer + verifier reproduction.

**Anchors:** `packages/stats/src/event.ts` `TokenSaverEvent { rawBytes, returnedBytes, createdAt }`; `packages/stats/src/index.ts` `readEvents`, `appendEvent`, `tokensFromBytes`, `formatDollarsSaved`; store path resolution; `apps/cli/src/main.ts` subCommands; the audit command for the CLI table-render pattern.

---

## Slice A — `@megasaver/entitlement` (MIT, security-critical)

### Task A1: Ed25519 license verify + `checkEntitlement`

**Files:** new package `packages/entitlement/` (package.json MIT, tsup, tsconfig); `src/license.ts`, `src/entitlement.ts`, `src/public-key.ts`, `src/index.ts`; Tests `test/license.test.ts`.

- [ ] **Step 1: Test (RED)** — in the test, generate a keypair: `const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")`. Write a test helper `signTestLicense(privateKey, payload)` producing `msp_<b64url(JSON payload)>.<b64url(sig)>` where `sig = crypto.sign(null, Buffer.from(JSON.stringify(payload)), privateKey)`. Inject the test public key into `verifyLicense(key, { publicKey, now })`. Assert:
  - a valid `{v:1,tier:"pro",id:"x",iat:0,exp:null}` → `{ valid:true, tier:"pro", expiresAt:null }`.
  - flip one byte of the payload b64 → `{ valid:false, reason:"invalid_signature" }`.
  - `exp` in the past → `{ valid:false, reason:"expired" }`.
  - not `msp_…` / no dot / bad b64 / non-JSON payload → `reason:"malformed"`.
  - a key signed by a DIFFERENT keypair → `invalid_signature`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `verifyLicense(key, deps)`: parse `msp_<p>.<s>`; b64url-decode; `crypto.verify(null, payloadBytes, deps.publicKey, sigBytes)`; on false → invalid_signature; parse payload JSON (malformed on error); check `v===1` + `tier` + `exp` vs `deps.now()`. **Fail-closed**: any throw → a `{valid:false}` result, never propagate. `public-key.ts` exports `MEGASAVER_PUBLIC_KEY` (a PEM SPKI string — a PLACEHOLDER with a `// TODO owner: replace via scripts/license/gen-keypair.mjs` comment; tests pass their own key so they don't depend on the placeholder). `checkEntitlement(feature, { storeRoot, now })`: read the stored license, `verifyLicense` it against `MEGASAVER_PUBLIC_KEY`, map to `EntitlementResult` (fail-closed).
- [ ] **Step 4: Run → PASS.** Commit `feat(entitlement): offline Ed25519 license verification`.

### Task A2: license storage + activate/status

**Files:** `src/store.ts` (or in entitlement.ts); Test `test/store.test.ts`.

- [ ] **Step 1: Test** — `activateLicense(storeRoot, key, deps)` with a valid test key + injected publicKey → writes `<storeRoot>/license.json` `{ key, activatedAt }` and returns `{ ok:true, tier, expiresAt }`; with a FORGED/invalid key → returns `{ ok:false, reason }` and writes NOTHING. `readLicense(storeRoot)` → the stored key or null. `deactivateLicense` removes it. `licenseStatus` → active/none.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — activate verifies BEFORE writing (reject invalid at activation); atomic write; best-effort read (missing/corrupt → null). Export all from `index.ts`.
- [ ] **Step 4: Run → PASS.** Commit `feat(entitlement): license activation + storage`.

### Task A3: `mega license` command + vendor tooling

**Files:** `apps/cli/src/commands/license.ts` + register in `main.ts`; `scripts/license/gen-keypair.mjs`, `scripts/license/issue.mjs`; `.gitignore` (private key); Tests `apps/cli/test/commands/license.test.ts`.

- [ ] **Step 1: Test** — `runLicenseActivate({ key, storeRoot, deps })` with a valid test key → prints "Pro activated" + tier; invalid → prints an honest rejection, exit 1. `runLicenseStatus` → "Pro (active)" or "no license (free)". Inject the publicKey + store for the test.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `mega license activate <key> | status | deactivate` wiring the seam with the real `MEGASAVER_PUBLIC_KEY` + store. `scripts/license/gen-keypair.mjs`: `crypto.generateKeyPairSync("ed25519")`, print the public SPKI PEM (to paste into public-key.ts), write the private PEM to `scripts/license/.private-key.pem` (gitignored). `scripts/license/issue.mjs <id> [--exp <iso>] [--priv <path>]`: sign a payload → print the `msp_…` key. Add `scripts/license/.private-key.pem` to `.gitignore`.
- [ ] **Step 4: Run → PASS.** `pnpm verify`. Commit `feat(cli): mega license + vendor key tooling`.

**Slice A boundary:** `pnpm verify` green. Grep the repo → NO private key committed, only the public PEM + a gitignored private path.

---

## Slice B — `packages/pro-analytics` (proprietary)

### Task B1: the pure analytics

**Files:** new `packages/pro-analytics/` (package.json `"private":true`, `"license":"SEE LICENSE IN LICENSE"`, tsup; a proprietary `LICENSE` file); `src/history.ts`, `src/export.ts`, `src/index.ts`; Tests.

- [ ] **Step 1:** Write the proprietary `LICENSE`: "© 2026 Halit Ozger. Source-available. Use of this package requires a valid Mega Saver Pro license; it is not licensed for use otherwise. No redistribution."
- [ ] **Step 2: Test (RED)** — `computeSavingsHistory(events, { bucket:"day" })` where events are `TokenSaverEvent`-shaped with `createdAt` on 3 days → 3 `HistoryPoint { bucket, tokensSaved, dollarsSaved, events }` with correct sums (reuse `tokensFromBytes` + `formatDollarsSaved` from `@megasaver/stats`); `bucket:"week"` groups by ISO week; empty → []. `computeSavingsByProject(rowsByProject)` → sorted `ProjectRow[]`. `exportSavings(points, "csv")` → a header + escaped rows; `"json"` → `JSON.stringify`. Deterministic.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** the pure fns. `pro-analytics` depends on `@megasaver/stats` (one-way; verify no cycle). CSV: quote fields containing `, " \n`, escape `"`→`""`.
- [ ] **Step 5: Run → PASS.** `pnpm verify`. Commit `feat(pro-analytics): historical savings + export (proprietary)`.

---

## Slice C — gated `mega savings history/export`

### Task C1: the gated commands

**Files:** `apps/cli/src/commands/savings/` (history.ts, export.ts, index.ts) + register `savings` in `main.ts`; `README.md` Pro section + honesty disclosure; `.changeset/`; Tests.

- [ ] **Step 1: Test** — `runSavingsHistory({ storeRoot, entitlementDeps, ... })`: with NO license → prints the upsell (`Historical savings analytics is a Mega Saver Pro feature. mega license activate <key>. Learn more: <url>.`), computes nothing, exit 0; with a valid test license (inject) → reads events, prints the history table / `--json` / `--csv` / `--out <file>`. `mega savings export --format csv` similarly gated. Assert the upsell path does NOT import/compute analytics (checkEntitlement gates first).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — each command: `const ent = checkEntitlement("savings-analytics", {storeRoot, now})`; `if (!ent.entitled) { print upsell; return 0 }`; else lazily `import("@megasaver/pro-analytics")`, read events (`readEvents`), compute, render. Register `savings` in `main.ts`. README: a "Pro" section + the honesty disclosure (gate is open-source/bypassable; license is unforgeable). Changeset: `@megasaver/entitlement` + `@megasaver/cli` minor (pro-analytics is private).
- [ ] **Step 4: Run → PASS.** Commit `feat(cli): mega savings history/export (Pro-gated)`.

## Final gate
- `pnpm verify` green. **Verifier reproduction (CRITICAL):** with a test keypair — `issue.mjs` a key → `mega license activate <key>` → `mega savings history` shows data; edit one byte of the key → activate rejected; issue an expired key → rejected; no license → `mega savings history` upsells (exit 0). Capture all.
- Changeset added.
- code-reviewer + critic + **security-reviewer**. Security focus: verify is fail-closed on every malformed/tampered/expired/wrong-key input; activate rejects invalid; NO private key in the repo (grep); no network/telemetry; the free CLI is unaffected without pro-analytics; the upsell never leaks/half-runs the Pro compute.

## Deferred
Stripe/billing + auto key delivery; licensing server / online activation; team/seat licenses; other premium modules; revocation lists; hardware binding.
