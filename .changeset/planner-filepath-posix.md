---
"@megasaver/core": patch
---

Make `PlannerCard.filePath` platform-stable.

`readPlannerBoard` and `writePlannerCard` built `filePath` with
`relative(projectRoot, …)` and emitted it raw, so on Windows every card carried
`.megasaver\planner\todo\my-card.md` while the same card on macOS/Linux carried
`.megasaver/planner/todo/my-card.md`. The value crosses the GUI bridge's JSON
boundary (`apps/gui/bridge/routes/planner.ts` → `card-drawer.tsx`), so the
identifier a client sees depended on the host that produced it.

This was the lone relative-path emitter in the repo that skipped normalization —
`indexer/src/scan.ts:95` (`toPosix`), `mcp-bridge/src/tools/get-edit-impact.ts:85`
(`replace(/\\/g, "/")`), `apps/cli/src/commands/memory/read-wiki.ts:37` and
`apps/gui/bridge/routes/memory-graph.ts:89` (`split(sep).join("/")`) all already
do it. `get-edit-impact.test.ts:155`, which asserts backslash-in → POSIX-out, is
that convention written down as a test.

All three `relative()` sites (`service.ts:63`, `:129`, `:153`) are normalized
together. Partial normalization would be the only hazard here, and none of the
three is load-bearing: every filesystem operation in the module builds its own
`join()` path (`fullPath`, `probe`, `targetFile`, `tmpFile`, `archiveTarget`),
and the `oldFilePath !== targetFile` rename check at `:159` compares two `join()`
values, never the relative one. `filePath` is purely an identifier.

Verified against `path.win32` semantics, reproducing the exact value CI reported:

```
win32  raw  ".megasaver\\planner\\todo\\initial-task.md"
win32  norm ".megasaver/planner/todo/initial-task.md"
posix  raw  ".megasaver/planner/todo/initial-task.md"
posix  norm ".megasaver/planner/todo/initial-task.md"
```

`basename(norm, ".md")` returns `initial-task` under both `win32` and `posix`,
so the parser's fallback-id path (`parser.ts:20`) is unaffected on either
platform.

Caught by `verify (windows-latest)`, where
`packages/core/test/planner-service.test.ts:39` failed on
`expect(card1.filePath).toContain(".megasaver/planner/todo/")`. The test was
asserting the intended contract; the service was violating it. Both it and the
sibling assertion at `:51` now pass unchanged.
