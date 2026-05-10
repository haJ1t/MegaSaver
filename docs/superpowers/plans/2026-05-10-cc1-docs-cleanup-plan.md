---
title: CC1 docs/wiki cleanup batch — plan
risk: LOW
status: active
created: 2026-05-10
updated: 2026-05-10
related: docs/superpowers/specs/2026-05-10-cc1-docs-cleanup-design.md
---

# CC1 Docs/Wiki Cleanup Batch — Plan

One-to-one mapping from spec items to file edits.

## Steps

1. **S9** — Edit `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`:
   §4 worked-example code block: replace 3-space gutter between columns
   with 2-space gutter in the status table output lines.

2. **T7** — Edit same file §4: insert annotation sentence after the
   worked-example code block clarifying the 3 lines are from 3 separate
   runs (one per outcome), not a single command invocation.

3. **T8** — Edit `wiki/index.md`: replace "v0.2 second-day team batch
   (7 PRs)" prose paragraph in the Status section with a bulleted list
   mirroring the first-day batch format (one bullet per PR with bold
   PR ref, commit hash, and summary).

4. **U4** — Edit `docs/conventions/multi-agent-dogfood.md`: append a
   "Cursor connector frontmatter contract" section documenting that
   `header` is written once on first seed; subsequent syncs only modify
   content inside the sentinels; user edits outside the block survive.

5. **U8+W8** — Edit `README.md`: replace stale "What exists now" /
   "Not built yet" content with accurate current state; add "Connectors"
   section listing 4 v0.1 built-in targets; add "CLI Reference" section
   listing all current subcommands.

6. **U10** — Edit `apps/cli/src/known-targets.ts`: add one-line comment
   above `KNOWN_TARGETS` explaining cross-package aggregation.

7. **V9** — Edit `wiki/entities/core.md`: update "116 tests" → "129 tests".
   Edit `wiki/entities/connectors-claude-code.md`: update "44 tests" → "45 tests".

8. **X6** — Edit `wiki/index.md` X-series paragraph: update `connector.ts`
   LOC reference from 369 to 419.

## Verification

`pnpm verify` from monorepo root must pass green (lint + typecheck + test).
