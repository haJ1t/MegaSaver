# @megasaver/entitlement

## 0.3.0

### Minor Changes

- 4403f40: Brain Autopilot (i14): the brain grows itself, safely.

  - core: `autopilot` module — a pure `scoreCandidate` rule table plus the
    `runAutopilot` engine over the existing session extractor — and
    `autopilot-store` (policy + digest state, fail-closed). Auto-approval
    requires cross-session recurrence: a failure repeating inside a single
    session is a retry storm, not a lesson, so `ExtractedCandidate.occurrences`
    is a display-only signal and never a scoring input. The shared
    `from-session:` dedupe keyword is now a core export so every writer agrees.
  - cli: `mega brain autopilot status|on|off|run` — dry-run free, real run Pro,
    honors the enabled toggle, per-session cap with a capped-out notice — and
    `mega brain digest` (Pro): single-keystroke y/n/e/s/u/a/q triage over the
    suggested backlog, auto-approved spot-review with revoke, raw-mode teardown
    on every exit path, non-TTY and `--json` fallbacks. `runMemoryApprove` now
    admits a `suggested` target so an auto-approval can be revoked; its core
    flip is extracted as `applyApprovalFlip`.
  - entitlement: `brain-autopilot` ProFeature key.
  - mcp-bridge: the from-session tool imports the shared dedupe prefix from core
    instead of redeclaring it. Behavior unchanged.

- eb74c35: Code-Truth Verify (i6): git-anchored memories that stale and heal.

  - core: `memory-anchor` module (codeAnchor/lastVerified schemas, best-effort
    `captureCodeAnchor`), `code-truth` module (pure `verifyAnchors` planner +
    `runVerify` git runner), whole-batch `applyMemoryEntryPatches`, and
    `STALE_WEIGHT` down-ranking for stale rows on includeStale surfaces.
    Contradiction closes `validTo` with ownership tracking
    (`closedByCodeTruth`); heal reopens only code-truth-owned closes. Anchor
    paths reject control characters at the schema boundary.
  - output-filter: public `extractBlocksForFile` polyglot per-file extraction.
  - cli: `mega memory verify` (free one-shot; `--install-hook` /
    `--uninstall-hook` Pro post-commit automation), `--symbol` inputs,
    `--no-anchor` opt-out, sweep verify pre-pass (Pro), show/explain anchor
    summary + verification badge.
  - mcp-bridge: `save_memory` symbol anchors, `get_relevant_memories`
    verification badges + Pro pre-recall spot-check with sentinel-guarded
    disclosure, new `verify_memories` tool (Pro).
  - stats/entitlement: `code-truth` ProFeature key, stale-recall-avoided ledger
    and "stale recall waste avoided" savings line.

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
