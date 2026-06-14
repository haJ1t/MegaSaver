---
"@megasaver/policy": minor
"@megasaver/core": patch
"@megasaver/cli": patch
---

Fix three bugs surfaced by a full feature-test pass.

- `rules apply --files` now matches `appliesTo` glob patterns. Matching
  used a plain `startsWith` prefix check, so globs like `*.ts` /
  `**/*.ts` never matched any path — the `--files` filter silently
  returned nothing. It now compiles globs through the policy
  `compileGlob` engine (newly exported from `@megasaver/policy`) while
  keeping the literal directory-prefix behaviour (`src/db/`).
- `mega output file|filter|exec` now surface the secret-redaction
  warning (`redacted N secret(s) before processing`) in text mode. The
  warning was produced and stored in the result but only visible via
  `--json`, hiding a security-relevant signal from CLI users.
- `mega index show <project> <bad-id>` now reports
  `invalid block id "<value>"` for a malformed block id instead of the
  misleading `name must be non-empty`.
