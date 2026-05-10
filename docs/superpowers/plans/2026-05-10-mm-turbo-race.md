---
title: MM turbo ^build race fix — plan
risk: LOW
status: active
created: 2026-05-10
updated: 2026-05-10
related: docs/superpowers/specs/2026-05-10-mm-turbo-race-design.md
---

# MM — turbo `^build` dep for vitest typecheck — Plan

Single-file config change. TDD-light: the "test" is the
3× cold-cache determinism gate (no new vitest cases — the bug
manifests in scheduling, not in code under test).

## Steps

1. **Read** `turbo.json` at worktree root. Confirm current `test`
   and `test:watch` shape: `dependsOn: ["build"]`. No other
   `dependsOn` entries on those tasks.

2. **Edit** `turbo.json`: change `test.dependsOn` and
   `test:watch.dependsOn` from `["build"]` to
   `["^build", "build"]`. Preserve `outputs`, `cache`,
   `persistent` fields. Do not touch other tasks.

3. **Verify** — from the worktree root:

   ```bash
   pnpm install
   pnpm exec turbo run test --force   # cold run 1
   pnpm exec turbo run test --force   # cold run 2
   pnpm exec turbo run test --force   # cold run 3
   pnpm verify
   ```

   All four must exit 0. Capture head + tail of each
   `turbo run test --force` output for the PR body.

4. **Ship** — append wiki/log.md entry, single squash commit,
   push, open PR with the 3× cold-run evidence and `Closes #60`.

## Risk

LOW. Config-only change. Reverting is a one-line diff.
