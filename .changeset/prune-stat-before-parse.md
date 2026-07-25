---
"@megasaver/content-store": patch
---

Read a chunk set's age from its mtime before parsing its body in `pruneOlderThan`.

The daily content-store sweep runs inside the Claude Code PostToolUse hook
(`maybeRunOverlayGc` -> `pruneOlderThan`, awaited by `runSaverHookFromProcess`),
so its cost is charged to a real user tool call. To read one `createdAt` string
it did `readFileSync` + `JSON.parse` + up to two whole-object zod `safeParse`s
per stored file — and each file holds an entire captured tool output. With
30-day retention and no byte cap, every sweep read essentially the whole store
to delete about a thirtieth of it.

Measured on a synthetic store of young sets (min of 5, nothing deleted):
37 MB across 300 sets 95.4 ms -> 0.8 ms, 73 MB across 600 sets 181.0 ms ->
1.6 ms. Cost now tracks file count, not stored bytes.

Chunk sets are write-once via `atomicWriteFile`, so mtime tracks `createdAt`;
this is the same stat gate `pruneIntentFiles` and `pruneSeenFiles` already use
on the sibling stores. Files whose mtime is past the cutoff still get the full
parse, so the "valid chunk set or leave it alone" guard is unchanged and
unknown or corrupt JSON is still never deleted.

One deliberate behaviour change: age comes from mtime, so a set written or
rewritten after the cutoff is retained even if its body claims an older
`createdAt`. That direction can only delay a delete by one sweep, never delete
early.
