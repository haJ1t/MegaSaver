---
"@megasaver/core": minor
"@megasaver/entitlement": minor
"@megasaver/mcp-bridge": patch
"@megasaver/cli": minor
---

Brain Autopilot (i14): the brain grows itself, safely.

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
