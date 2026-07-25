---
"@megasaver/daemon": patch
"@megasaver/cli": patch
---

fix(daemon): keep the content-derived chunk-set id on the daemon path

`makeRecord` stripped `newId` before POSTing to `/excerpt` (a closure is not
JSON-serializable) and `excerptRequestSchema` had no field to carry it, so
whenever `mega daemon serve` was up the P1 content-addressed chunk-set id
degraded to `randomUUID()`. The documented property — byte-identical
compressions produce identical recovery footers — silently never held under the
daemon, and identical re-emits accumulated extra chunk-set files.

`/excerpt` now accepts an optional `chunkSetId` (validated by the existing
`safeSegmentSchema`, so a traversal value is still a 400) and the hook sends
`newId()`'s derived value.

Measured, two byte-identical `excerptHandler` calls in one session:

- before: ids `d3e099f7-…` / `721d0c22-…`, 2 files under `content/<wk>/<sess>/`
- after: id `cs-6c72797b6030b4ccdb3cbffd47e5d85a` both times, 1 file
