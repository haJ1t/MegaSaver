---
"@megasaver/stats": patch
---

Repair registry summaries that the pre-fix overlay GC sweep clobbered. The
layout discriminator stopped new damage but left already-damaged stores
permanently dead: `stats/<projectId>/<sessionId>.json` held an overlay-shaped
summary, so `readSummary` and `appendEvent` both threw `store_corrupt` on every
call — `mega output exec/file/filter` returned `store_write_failed` and
`mega session saver stats --session <id>` threw, forever.

A summary that is valid JSON but fails the registry schema is now rebuilt from
the intact `<sessionId>.events.jsonl` and persisted, mirroring the overlay
path's rebuild-from-JSONL recovery. A summary that is not JSON at all keeps the
existing loud `store_corrupt` posture: that is a torn write, not a layout
mismatch, and the registry event carries no `secretsRedacted`/`chunksStored`,
so a rebuild would silently zero those two counters.
