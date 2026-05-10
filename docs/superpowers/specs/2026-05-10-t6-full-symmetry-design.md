---
title: T6 full sync text symmetry — design
risk: MEDIUM
status: active
created: 2026-05-10
updated: 2026-05-10
---

# T6 Full Sync Text Symmetry — Design

Promotes T6 from PARTIAL (PR #45, error-lines only) to FULL: every
`mega connector sync` text-mode output line carries `session=<id|none>`,
matching the format `mega connector status` has always emitted.

## Problem

PR #45 added `session=<id|none>` only to `error` status lines. All
other statuses (skipped/created/noop/wrote) still used the old
3-column format `<id>  <relPath>  <status>`. This asymmetry made
tooling that parses sync output treat error lines differently from
non-error lines, and created a discrepancy with `connector status`
output.

## Solution

Remove the `else if (status === "error")` guard in `emit()` inside
`apps/cli/src/commands/connector/sync.ts`. Every non-JSON branch now
calls `formatStatusLine(target, status, sessionId ?? "none")`,
producing a 4-column line for all statuses.

## Byte-Compat Break

- **Before (T6-partial):** `claude-code  CLAUDE.md  wrote`
- **After (T6-full):**     `claude-code  CLAUDE.md  wrote  session=<id>`

Any consumer that parsed the 3-column format for non-error lines must
update to expect the 4-column format. Error lines are unchanged.

## Scope

Single-function change in `sync.ts` (`emit()`). Test file updated to
reflect new output format (~13 assertion sites in `connector.test.ts`).
Spec `2026-05-10-json-write-side-design.md` §2 updated from
"T6 (partial)" to "T6 (full)".
