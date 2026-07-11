# @megasaver/entitlement

## 0.2.1

### Patch Changes

- 64a5300: `mega brain export <project>` / `mega brain import <project> <file>` — the
  portable project brain (Mega Saver Pro). Export writes the knowledge layer
  (approved project-scoped memories, rules, failed-attempt lessons) to a
  2-line `.megabrain` bundle with a SHA-256 payload integrity hash and
  firewall redaction (findings counted in the manifest). Import verifies the
  hash, then merges everything as NEW entries with `approval: "suggested"` —
  nothing activates until `mega memory approve`; exact duplicates are skipped
  and counted. Core gains `exportBrain` / `importBrain` /
  `parseBrainBundle` / `serializeBrainBundle`.

## 0.2.0

### Minor Changes

- 3ebc27d: Pro entitlement + historical savings analytics (open-core).

  The CLI core stays MIT and fully functional with no license. A new offline,
  Ed25519-signed license gates NEW Pro features; the first is historical savings
  analytics.

  - **@megasaver/entitlement** (new, MIT): fail-closed `checkEntitlement` +
    offline Ed25519 `verifyLicense` + license storage (`activateLicense`,
    `licenseStatus`, `deactivateLicense`). Anything tampered, expired, wrong-key,
    or malformed resolves to "not entitled" — never propagates a throw. Powers the
    new `mega license activate | status | deactivate` command.
  - **@megasaver/cli**: new `mega savings history [--by day|week|project]
[--json|--csv|--out]` and `mega savings export --format csv|json [--out]`.
    `checkEntitlement` gates FIRST: with no license each command prints an honest
    one-line upsell and exits 0, importing and computing nothing; only an entitled
    run lazily imports the Pro module, reads events (through `@megasaver/core`), and
    renders. The free CLI is unaffected.

  The proprietary Pro compute lives in `@megasaver/pro-analytics` (private,
  source-available, not MIT — see `packages/pro-analytics/LICENSE`), so it is not
  part of this changeset's published surface.

  Honesty: the gate is MIT/open-source and therefore bypassable by editing the
  source — inherent to open-core, stated plainly, no security theater. What is not
  forgeable is the license itself: keys are Ed25519-signed by an offline private
  key and verified against a public key baked into the CLI, fully offline.
