---
title: mega brain sync — E2E-encrypted BYO cloud sync
status: approved
risk: CRITICAL
approved-design: 2026-07-11
revised: 2026-07-11 (architect pass — 2 BLOCKER, 4 SHOULD-FIX, 2 NIT incorporated)
---

# `mega brain sync` — E2E-encrypted BYO cloud sync (2.1)

## Problem

2.0 shipped `mega brain export/import`: a portable, SHA-256-hashed,
firewall-redacted `.megabrain` bundle with suggested-gate merge on import
(source: `wiki/entities/brain-portability.md`). Moving a brain between
machines is manual: export, carry the file, import. Users working across a
laptop and a desktop re-do this on every change, or drift apart.

Post-2.0 direction locked path B+C (up-market backbone, distribution
tactical); 2.1 = E7 brain sync (source:
`wiki/syntheses/post-2.0-growth-portfolio.md`, user 2026-07-11).

## Locked decisions (user, 2026-07-11)

1. **Hybrid BYO-first.** 2.1 syncs to the user's own S3-compatible storage.
   Managed MegaSaver cloud is deferred to the Team tier (3.0); the sync
   protocol must not preclude it.
2. **Transport: S3-compatible API only.** Covers Cloudflare R2, AWS S3,
   Backblaze B2, MinIO. Git transport is out of scope. Conditional-write
   support is verified per-endpoint at init (see protocol); providers that
   do not enforce it are rejected.
3. **Key management: generated keyfile.** 256-bit random symmetric key at
   `<store-root>/brain-sync.key` (store root = existing `resolveStorePath`
   convention: `$XDG_DATA_HOME/megasaver` → `~/.local/share/megasaver`
   POSIX, `%LOCALAPPDATA%/megasaver` win32 — same dir as `license.json`)
   plus a one-time-displayed recovery code. No passphrase derivation.

## Goals

- One command keeps a project brain identical across the user's machines
  through a bucket only they control.
- Server-side storage holds ciphertext only; object names carry no
  plaintext-derived fingerprint. The storage provider can never read or
  confirm brain content.
- Reuse the shipped 2.0 machinery: firewall-redacted export path and
  suggested-gate merge import path. Sync adds transport + crypto, not a new
  memory pipeline.
- Pro-gated: reuses the existing `"brain-portability"` `ProFeature` key via
  `checkEntitlement` (`@megasaver/entitlement`); unentitled → print upsell,
  exit 0 (existing convention).

## Non-goals (2.1)

- No managed MegaSaver cloud, no accounts, no server code.
- No Team/multi-user sharing; single user, multiple machines.
- No git transport, no selective/partial sync, no sessions/stats sync.
- No key rotation command (manual procedure: `init --reset` + full re-push).
- No background daemon/watch mode; sync runs when invoked.
- No interactive prompts; destructive re-init requires explicit flags.

## Architecture

New package `packages/brain-sync` → `@megasaver/brain-sync`. One bounded
context: crypto + transport + sync protocol. **It does NOT import core**:
the engine operates on opaque `bundleText` strings; the CLI orchestrates
`exportBrain`/`importBrain` (which need a `CoreRegistry`) and injects them
as callbacks. This keeps the CRITICAL crypto package's runtime dependency
surface at exactly `@aws-sdk/client-s3` + `zod`.

```
apps/cli ──► @megasaver/core (brain-bundle: exportBrain/importBrain)
    │
    └────► @megasaver/brain-sync (crypto + S3 transport + sync engine)
                └─► S3-compatible endpoint (user's bucket)
```

`@aws-sdk/client-s3` MUST be lazy-loaded via dynamic import (source:
`wiki/decisions/lazy-load-heavy-deps.md`); a no-eager-load guard test
mirrors `packages/output-filter/test/no-eager-typescript.test.ts`. The CLI
lazy-imports `@megasaver/brain-sync` only after the entitlement gate passes
(same pattern as `brain export` lazy-importing core). Bundle impact
measured in verification.

## Commands & UX

- `mega brain sync init`
  - Flags: `--endpoint <url>`, `--bucket`, `--prefix` (default
    `megasaver-brain/`, normalized to trailing `/`), `--region` (default
    `auto`), `--path-style` (boolean, default true), `--store`.
  - Endpoint must be `https://`; `http://` allowed only for
    `localhost`/`127.0.0.1`/`::1` (MinIO dev).
  - Runs the conditional-write capability probe (see protocol). Probe
    failure → hard error `conditional_writes_unsupported`; config is NOT
    written.
  - Generates the keyfile; prints the recovery code ONCE with an explicit
    "store this now, it will not be shown again" warning. Refuses to
    overwrite an existing keyfile/config unless `--reset --force`
    (regenerates key, wipes config incl. last-seen map; plain-language
    data-loss warning). A machine that plain-`init`s a fresh key against a
    prefix already used by another key is still safe: the undecryptable
    remote manifest triggers `wrong_key` and is never overwritten.
  - Writes non-secret config to `<store-root>/brain-sync.json` (atomic).
  - Credentials are NEVER written by us: resolved at runtime from
    `MEGA_SYNC_ACCESS_KEY_ID` / `MEGA_SYNC_SECRET_ACCESS_KEY` env vars,
    falling back to the standard AWS credential chain.
  - `--join <recovery-code>` (or `--keyfile <path>`): reconstruct/copy the
    existing key instead of generating; no recovery code printed; accepts
    an existing remote manifest.
- `mega brain sync <project>` — safe bidirectional flow (= push semantics
  below: merge anything unseen, then publish).
- `mega brain sync push <project>` — same safe flow (never publishes
  without first merging unseen remote changes).
- `mega brain sync pull <project>` — pull/merge only.
- `mega brain sync status <project>` — remote generation vs local
  last-seen, remote `updatedAt`, up-to-date flag. Read-only, no mutation.
- `mega brain sync reset <project> --force` — destructive: deletes that
  project's remote manifest (its objects become unreadable orphans) so a
  new chain can start, e.g. after key loss. Requires `--force`;
  plain-language data-loss warning.
- All subcommands entitlement-gated (`brain-portability` feature);
  unentitled → upsell text, exit 0. Runtime errors → single-line message,
  exit 1.

## Crypto design

Node built-in `node:crypto` only. No libsodium, no age.

- Keyfile: 32 random bytes (`crypto.randomBytes`), stored raw at
  `<store-root>/brain-sync.key`. Written atomically with the temp file
  CREATED at `mode: 0o600` (no create-then-chmod window), then renamed.
- Recovery code: base32 (RFC 4648 alphabet, upper-case, no padding) of
  `key || sha256(key)[0..2)` — 34 bytes → 55 chars, displayed in 5-char
  dash-separated groups. The 2-byte checksum is validated on `--join`;
  a typo fails immediately as `bad_recovery_code`, never as a
  tamper-looking decrypt error later.
- Encryption: AES-256-GCM. Per-object random 96-bit IV
  (`crypto.randomBytes(12)`), never reused; blob layout
  `[iv(12)][ciphertext][tag(16)]`.
- AAD binds context, **including the project id** — one keyfile is shared
  across all of a user's projects, and remote per-project isolation is only
  the storage prefix, which the untrusted provider controls; binding
  `projectId` into every AAD makes a cross-project ciphertext transplant
  fail authentication under the shared key:
  - manifest object: `megasaver-brain-sync:v1:manifest:<projectId>` (its
    generation cannot live in its own AAD — only known after decrypt;
    rollback is caught by the monotonicity check instead);
  - brain object: `megasaver-brain-sync:v1:object:<projectId>:<objectKey>`
    where `objectKey` is the object's logical key (below). `projectId` is a
    uuid and `objectKey` contains no `:`, so the delimiters are unambiguous.
- Tamper/auth failure → hard error naming the object; never partial output.
- Key never leaves the machine except as the user-held recovery code.

## Remote layout & sync protocol

Content is small (`.megabrain` bundles are KB–MB); whole-object storage,
no chunking. Brains are per-project, so the remote space is scoped by the
stable project id: the effective prefix for a project is
`<configured-prefix><projectId>/`. Logical keys (transport prepends the
effective prefix):

```
manifest.json.enc            encrypted JSON: { schemaVersion: 1, generation,
                             updatedAt, brainSha256, objectKey }
objects/<uuid>.enc           encrypted full bundle; random name, written
                             once, never overwritten
```

- `brainSha256` = sha256 of the PLAINTEXT `.megabrain` bundle text; lives
  only inside the encrypted manifest (post-decrypt integrity check).
  Object names are random UUIDs — the provider sees no plaintext-derived
  fingerprint and no cross-time equality signal.
- `objectKey` inside the manifest binds manifest→object; the object's AAD
  binds the name AND the projectId, so transplanting ciphertexts between
  names, generations, or projects fails authentication.

**Conditional-write rules (every manifest PUT is conditional):**

- Manifest GET returned 404 this run → PUT with `If-None-Match: *`
  (bootstrap; two machines racing first push cannot clobber each other).
- Manifest existed → PUT with `If-Match: <etag>` of a manifest that was
  **successfully decrypted in this run**. A manifest that fails decryption
  is NEVER overwritten — error `wrong_key` ("use `init --join` with the
  original recovery code"); the only way past it is `init --reset --force`.

**Capability probe (at init, before config is written):** PUT a probe key
unconditionally; conditional-PUT it again with a deliberately stale ETag
and require HTTP 412; conditional-PUT with `If-None-Match: *` over the
existing key and require 412; DELETE the probe. Any non-enforcing endpoint
→ `conditional_writes_unsupported`, init fails. `conditionalWritesVerified:
true` is recorded in config; smoke evidence must name the providers tested.

**Sync flow (push semantics — also what bare `mega brain sync` runs):**

1. GET manifest (+ETag). Decrypt failure → `wrong_key`, stop.
2. If remote generation < local last-seen → `rollback_detected`, stop.
   If remote generation > local last-seen → pull step 3 first (merge
   before publish; a push can never drop unseen remote entries).
3. Pull/merge: GET `objectKey`, decrypt (AAD = projectId + name), verify `brainSha256`,
   `importBrain` merge (suggested-gate), then persist last-seen =
   remote generation.
4. Export local bundle (firewall-redacted 2.0 path). If its sha256 equals
   the remote manifest's `brainSha256` → up-to-date, stop (no generation
   churn).
5. PUT new brain object at fresh `objects/<uuid>.enc` (unconditional —
   unique name, collision-free, orphan-safe).
6. PUT manifest conditionally (rules above) with `generation =
   remote.generation + 1` (or 1 on bootstrap).
   - 412 → best-effort DELETE the just-written orphan object, re-run from
     step 1 (bounded: 3 attempts, then `sync_conflict` telling the user to
     re-run).
   - success → persist last-seen = new generation; best-effort DELETE the
     previously referenced object. Deletion failures are ignored (orphans
     cost cents; correctness never depends on them).

**Local last-seen generation:** stored in `<store-root>/brain-sync.json`
as a per-project-id map, persisted only AFTER `importBrain` returns (an
interrupted import re-pulls on the next run — import is
idempotent/self-healing by 2.0 design). `init` writes a fresh config with
an empty map. A freshly joined machine has no last-seen, so its FIRST pull
per project inherently trusts the served manifest (TOFU); rollback
protection covers every subsequent pull.

## Merge semantics

Entirely delegated to the shipped 2.0 import machinery: imported memories
re-enter as `approval: "suggested"` with fresh ids and provenance
(`brain-import:<sourceProject>`), dedupe by content/rule/task keys, nothing
activates until `mega memory approve`. Sync introduces NO new merge logic;
if import semantics change, sync inherits them. Note: cross-machine
`updatedAt` comparisons inherit wall-clock skew between machines (2.0
behavior, documented, not changed).

## Threat model

| Actor / vector | Mitigation |
|---|---|
| Storage provider reads objects | Client-side AES-256-GCM; provider sees ciphertext + sizes only |
| Provider fingerprints content via object names | Names are random UUIDs; plaintext hash lives only inside the encrypted manifest |
| MITM on endpoint | HTTPS enforced (http only for localhost dev); GCM auth rejects modified ciphertext regardless |
| Ciphertext swap/transplant between objects or generations | Object AAD binds the name; authenticated manifest binds `objectKey` + `brainSha256` |
| Cross-project transplant (provider serves project A's ciphertexts under project B's prefix; one keyfile is shared across the user's projects) | Every AAD binds `projectId` (`…:manifest:<projectId>`, `…:object:<projectId>:<objectKey>`) — a foreign project's ciphertext fails GCM auth under the shared key |
| Manifest rollback (old manifest re-served) | Generation monotonicity vs persisted last-seen, checked on every pull after the first (first pull on a fresh machine is TOFU) |
| Concurrent writers lose updates | All manifest PUTs conditional (`If-Match` / `If-None-Match: *`); enforcement verified per-endpoint by the init probe; bounded CAS retry |
| Stolen bucket credentials (no keyfile) | Attacker reads ciphertext only; cannot decrypt or forge (no key) |
| Stolen keyfile (no bucket creds) | Attacker cannot reach data; both factors required |
| Weak user secret | Eliminated by design: key is generated, not derived |
| Recovery-code typo at join | 2-byte sha256 checksum → immediate `bad_recovery_code` |
| Local keyfile exposure | Temp file created `0o600` then renamed (no chmod window); machine-trust boundary documented |
| Second machine plain-`init` onto used prefix (wrong new key) | `prefix_in_use` refusal without `--join`/`--reset`; undecryptable manifest is never overwritten |
| Secret leakage into brain content | Export path is firewall-redacted (2.0 guarantee) — sync never touches unredacted stores |
| Credential leakage by us | Creds never written to config/logs/telemetry; endpoint+bucket never sent in telemetry |

Out of scope: compromised local machine (attacker with user privileges owns
the plaintext store anyway), storage-provider availability.

## Error handling

- Boundary validation (Zod, `.strict()`) on: config file, decrypted
  manifest, recovery-code input, endpoint URL.
- Error type: `BrainSyncError` with a closed `code` union
  (`wrong_key`, `rollback_detected`, `hash_mismatch`, `decrypt_failed`,
  `precondition_failed`, `sync_conflict`, `conditional_writes_unsupported`,
  `bad_recovery_code`, `keyfile_missing`, `keyfile_invalid`,
  `config_invalid`, `manifest_invalid`, `object_missing`,
  `insecure_endpoint`, `transport_error`).
- Network/SDK failures surface as single-line actionable errors (no raw
  SDK stack dumps into agent context). The transport (the sole aws-sdk
  boundary) wraps every SDK failure as `transport_error` carrying only
  op + key + error name + status — never the SDK message/stack (which can
  echo the access-key id).
- `object_missing` = the live manifest references an object absent from the
  store. In `pull` it surfaces to the user; in `push` it is treated as a
  concurrent supersession and retried within the bounded CAS loop (a
  competing push deleted the old object after committing a newer manifest).
- No silent retries except the bounded CAS loop.
- Orphan objects: a push that fails after writing its content object, or
  whose best-effort cleanup of the superseded object fails, leaves an
  unreferenced encrypted object in the user's bucket. These are cost-only
  (no correctness/security impact — every live manifest names a present
  object) and are NOT swept in 2.1; `sync reset` clears a project's remote
  wholesale. A GC sweep of `objects/` not named by the live manifest is a
  documented later-nicety, deliberately deferred (YAGNI).

## Testing & evidence

- Unit: encrypt/decrypt roundtrip; IV uniqueness across calls; tamper →
  auth error; AAD mismatch (renamed object) → error; recovery code
  roundtrip → identical keyfile; checksum typo → `bad_recovery_code`;
  base32 vectors; config Zod rejects bad input + http endpoint; manifest
  schema rejects unknown fields.
- Integration: in-process S3 test double (node:http, in-memory,
  implements ETag + `If-Match`/`If-None-Match: *` semantics with S3-style
  XML errors). Scenarios: bootstrap race, pull/merge, skip-unchanged,
  CAS conflict → bounded retry, rollback detection, wrong-key refusal,
  probe pass/fail. Two temp-store "machines" run the full
  init → push → join → pull → merge flow against real core registries.
- Bundle guard: child-process `moduleLoadList` test asserts
  `@aws-sdk/client-s3` is not loaded by importing `dist/index.js`
  (mirrors `no-eager-typescript.test.ts`).
- Smoke evidence (DoD item 5): captured terminal session against a real
  R2 and/or MinIO endpoint, both machines simulated, generations and
  before/after brain hashes shown, probe result shown per provider.
- `pnpm verify` green; changeset: `"@megasaver/brain-sync": minor`,
  `"@megasaver/cli": minor`.

## CRITICAL chain requirements

Per `docs/conventions/risk-modes.md` (cryptographic ops ⇒ CRITICAL):

- Architect design pass — **DONE 2026-07-11** (Plan-agent stand-in, fresh
  context): 2 BLOCKER (conditional-PUT portability → init probe; manifest
  PUT preconditions → conditional-write rules), 4 SHOULD-FIX (object-name
  plaintext oracle → UUID names; last-seen persistence; recovery-code
  checksum; keyfile mode race), 2 NIT (core-free package; deviceId cut).
  All incorporated above.
- `code-reviewer` AND `critic` separate pre-merge passes (fresh contexts;
  author ≠ reviewer).
- Security-reviewer pass focused on the crypto design + secrets handling.
- Tracer evidence loop on the CAS race behavior (concurrent-push test
  transcript as evidence).
- Verifier pass with reproduction evidence.
- Forbidden: autopilot/ralph/unsupervised loops; no aggressive log
  compression during this feature's debugging.

## Manual user confirmation (CRITICAL requirement)

- 2026-07-11: user approved the design in-session ("onayladım spec yaz",
  then approved this revised spec's direction via "onayladım plana geç")
  after explicit CRITICAL-risk notice, covering: hybrid BYO-first scope,
  S3-only transport, keyfile key management, new `@megasaver/brain-sync`
  package.
- Remaining confirmation required BEFORE merge: user reviews smoke evidence
  and explicitly approves the release that first ships these commands.
