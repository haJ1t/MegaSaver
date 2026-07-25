---
"@megasaver/stats": patch
---

Stop a `mega audit` / `mega hooks status` READ from destroying registry-session
stats.

The layout discriminator added in `fix/gc-reconcile-clobbers-legacy-summaries`
guarded `reconcileOverlaySummaries` only. `readOverlaySummaryAnyWorkspace` still
walked every `stats/<dir>` as an overlay workspace behind `isSafeSegment`, and
it is a SELF-HEALING read: a summary that fails
`overlaySessionTokenSaverStatsSchema` is rebuilt and written back
(`loadOverlaySummarySelfHealing` → `rebuildGuarded` → `atomicWriteFile`). A
registry summary at `stats/<projectId>/<sessionId>.json` always fails that
schema, so the scan overwrote it with a zeroed overlay summary — the same data
loss, now on a read path reachable from three commands (`mega audit session`,
`mega audit honest`, `mega hooks status --session`) instead of the once-a-day GC
sweep. `mega audit honest` does not even consult the registry first.

Measured (temp store, one registry `appendEvent`, then a single
`readOverlaySummaryAnyWorkspace(store, <sessionId>)` call), before the fix:

```
BEFORE {"sessionId":"1111…","eventsTotal":1,"rawBytesTotal":10000,
        "bytesSavedTotal":9000,"secretsRedactedTotal":2,"chunksStoredTotal":3,…}
SCAN   {"workspaceKey":"22222222-…","summary":{"liveSessionId":"1111…",
        "eventsTotal":0,…all zeros…,"rebuiltAt":"…"}}
AFTER  {"liveSessionId":"1111…","eventsTotal":0,…all zeros…,"rebuiltAt":"…"}
READ   readSummary THREW store_corrupt
```

After the fix, same store: `SCAN null`, `AFTER` byte-identical to `BEFORE`,
`readSummary` returns `bytesSavedTotal: 9000`.

All three `stats/*` walkers now share one `overlayWorkspaceKeys` helper that
applies the `workspaceKeySchema` discriminator (16 lowercase hex, what
`encodeWorkspaceKey` emits), so the next walker added cannot reintroduce this.
`readAllWorkspaceTokenSaverTotals` is unchanged in behaviour — registry
summaries already failed its schema filter — it just no longer descends into
registry dirs.
