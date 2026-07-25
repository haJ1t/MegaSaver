---
"@megasaver/stats": patch
---

Stop the daily GC sweep from destroying registry-session stats.

`reconcileOverlaySummaries` walked every `stats/<dir>` as an overlay workspace,
filtered only by `isSafeSegment`. Registry sessions live in the same tree under
`stats/<projectId>/<sessionId>.json`, so one sweep (`maybeRunOverlayGc`, once a
day from the PostToolUse saver) rewrote them as overlay summaries.

Measured on a store holding one registry session plus a `handoff.events.jsonl`
ledger, before → after:

```
before  {"sessionId":"1111…","eventsTotal":1,"bytesSavedTotal":9000,
         "secretsRedactedTotal":2,"chunksStoredTotal":3,…}
after   {"liveSessionId":"1111…","eventsTotal":0,"bytesSavedTotal":0,
         "secretsRedactedTotal":0,"chunksStoredTotal":0,…,"rebuiltAt":…}
```

`rebuilt` was 2, and the sweep also fabricated `stats/<projectId>/handoff.json`
out of the handoff ledger (same for the `guard` / `warm-start` / `code-truth`
ledgers). The rewritten file no longer parses as `sessionTokenSaverStatsSchema`,
so `readSummary` and `appendEvent` threw `store_corrupt` from then on — every
later `mega output exec/file/filter` in that session returned
`store_write_failed`, and `mega session saver stats --session <id>` threw.

The sweep now only enters dirs matching `workspaceKeySchema` (16 lowercase hex,
what `encodeWorkspaceKey` emits) — the same layout discriminator
`locateChunkSet` already uses. Same store after the fix: `rebuilt` 0, the
registry summary byte-identical, no `handoff.json`, and a real overlay
workspace in that store still repaired (`eventsTotal` 1 → 2).
