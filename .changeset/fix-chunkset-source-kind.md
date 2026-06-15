---
"@megasaver/context-gate": patch
---

Fix `recordAndFilterOverlayOutput` storing every overlay chunk-set with
`source: { kind: "file", path: label }` regardless of the tool. A Bash
command or grep was recorded as a file path in the stored chunk-set's
`source` metadata. The `input.sourceKind` is now mapped to the matching
`OverlayChunkSet["source"]` variant (`command` / `grep` / `fetch` /
`file`). Cosmetic correctness only — the hook's behaviour and lossless
raw recovery are unaffected; the overlay event already recorded the
correct `sourceKind`.

Note: the `fetch` variant's `url` is schema-validated (`z.string().url()`),
so a future `sourceKind: "fetch"` caller must pass the actual URL as the
label. No current caller emits `fetch` (hook matcher is
`Read|Bash|Grep|Glob|LS`), so there is no behaviour change today.
