---
title: CC1 docs/wiki cleanup batch — design
risk: LOW
status: active
created: 2026-05-10
updated: 2026-05-10
---

# CC1 Docs/Wiki Cleanup Batch — Design

9 critic-flagged follow-ups from PRs #15–#21. Docs/wiki only; no
source code changes.

## Items

| # | ID | Target file | Decision |
|---|-----|-------------|----------|
| 1 | S9 | `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md` §4 | Fix 3-space gutter in worked example to 2-space (match impl + tests). |
| 2 | T7 | Same file §4 worked example | Add annotation clarifying the 3 status lines are from separate runs (one per outcome), not a single run. |
| 3 | T8 | `wiki/index.md` Status section X-series paragraph | Restructure the PR #20 followups (X-series) paragraph into a bulleted list. T8's intent: whichever followups paragraph is touched next gets list format. |
| 4 | U4 | `docs/conventions/multi-agent-dogfood.md` | Add paragraph documenting cursor connector user-edit frontmatter contract: `header` written once on first seed; subsequent syncs only modify content inside `MEGA_SAVER_BLOCK_START`/`MEGA_SAVER_BLOCK_END`; user edits to frontmatter/headings/text outside the block are preserved. |
| 5 | U8+W8 | `README.md` | Refresh stale README: add "Connectors" section (4 built-in targets) and "CLI Reference" section (all current subcommands). |
| 6 | U10 | `apps/cli/src/known-targets.ts` | Add one-line comment explaining cross-package aggregation of `KNOWN_TARGETS`. |
| 7 | V9 | `wiki/entities/core.md` | Update test-count line: 116 → 129 (verified via `pnpm --filter @megasaver/core test`). Scan other entity pages for stale counts; `cli.md` had no count; `connectors-claude-code.md` says 44 (actual 45); `connectors-generic-cli.md` has no count; `connectors-shared.md` has no count; `shared.md` has no count. Update `connectors-claude-code.md` count too. |
| 8 | X6 | `wiki/index.md` Status section X-series paragraph | Update `connector.ts` LOC: actual is 419 (verified via `wc -l`). |

## Scope boundary

No TypeScript source changes. No test changes. No schema changes.
All edits are markdown only.
