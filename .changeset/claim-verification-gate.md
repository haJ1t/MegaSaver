---
"@megasaver/stats": minor
"@megasaver/context-gate": minor
"@megasaver/connector-claude-code": minor
"@megasaver/cli": minor
---

Claim-Verification Gate: exec receipts now record the child exit code
(`childExitCode`, additive-optional on both token-saver event schemas);
new `mega verify claims` scans caller-provided text for success claims
and joins them to receipts in a time window (`--json`, `--strict`);
opt-in Stop-hook reminder via `mega verify enable-hook` (warn-only,
fail-open, off by default).
