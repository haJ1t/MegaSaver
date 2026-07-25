---
"@megasaver/context-gate": patch
---

Fix a lost-update race in `recordSeenOutput` (`saver-seen.ts`), the P1 first-sight
ledger that decides whether the PostToolUse saver may rewrite a tool result.

`mega hooks install` registers `mega hooks saver` as Claude Code's PostToolUse
hook, so every tool result in a turn runs in its **own process** — and every tool
result of one turn carries the same `session_id`, hence the same
`stats/<workspaceKey>/saver-seen/<sessionId>.json`. The read-modify-write
(`readHashes` → push → `writeFileSync(tmp)` → `renameSync`) was unlocked, so
parallel tool calls clobbered each other: the last rename won and the other
hashes were gone for good.

Measured through the exported function with real OS processes (4 writers, 24
barrier-synchronised rounds, one hash per writer per round — the production shape
of one hash per hook process): of the hashes a writer had already *observed* land
in the ledger, 22–39 of ~96 were missing at the end of the run, on 5 of 5 runs.
After the fix, 0 missing on 10 of 10 runs.

The consequence is fail-open by design, so no tool call ever breaks and the store
cannot corrupt (the chunk-set id is content-derived, so a repeat compression
reuses the same id). What it costs is the guarantee the file exists for: a dropped
hash makes `hasSeenOutput` return false, the saver rewrites that `tool_result`
again, and the prompt-cache churn measured in `wiki/syntheses/saver-cache-churn.md`
(0.96x balanced / 0.93x aggressive) happens anyway — the exact regression the
first-sight guard was shipped to prevent.

Fixed with the lock this repo already applies to the identical shape one call
earlier in the same hook: `withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs:
5000 })`, the same constants as `appendOverlayEvent` (`stats/store.ts`, E26) and
`saver-heartbeat.ts` (E25), keyed on the same (workspaceKey, sessionId) scope.
`hasSeenOutput` stays unlocked — it is a single read of an atomically renamed
file, so it cannot tear.

`withFileLock` remains best-effort: a writer contended past 50 ms skips its write
rather than stalling the agent. That is the pre-existing fail-open (one redundant
compression), not a lost update, so the guard test asserts the lost-update
property directly — every record a writer saw land must still be there — instead
of a survivor count that machine load could move.
