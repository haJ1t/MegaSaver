---
title: T6 full sync text symmetry — plan
risk: MEDIUM
status: active
created: 2026-05-10
updated: 2026-05-10
spec: docs/superpowers/specs/2026-05-10-t6-full-symmetry-design.md
---

# T6 Full Sync Text Symmetry — Plan

## Steps

1. **Worktree setup**
   Branch `feat/t6-full-symmetry` off `origin/main` (cf145da).
   `pnpm install && pnpm build`.

2. **Source change** — `apps/cli/src/commands/connector/sync.ts`
   Remove `else if (status === "error")` guard from `emit()`.
   All text-mode paths call `formatStatusLine(target, status, sessionId ?? "none")`.
   Update inline comment from "T6 (partial)" to "T6 (full)".

3. **Test updates** — `apps/cli/test/connector.test.ts`
   Fix every assertion that expected a 3-column sync line
   (skipped/created/noop/wrote/error) to expect the 4-column form
   `<id>  <relPath>  <status>  session=<id|none>`.
   Determine the correct session id per assertion from the seeded
   sessions in that describe block.

4. **Spec update** — `docs/superpowers/specs/2026-05-10-json-write-side-design.md`
   §2: change "T6 (partial)" framing to "T6 (full)"; document byte-compat break.

5. **Verify** — `pnpm verify` GREEN.

6. **PR** — title `feat: T6 full sync text symmetry (every line carries session=)`.
   Body: byte-compat break explanation, test site count, link to PR #45.

## Expected test site count

~13 assertion sites in `connector.test.ts` updated.
