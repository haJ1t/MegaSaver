---
"@megasaver/indexer": patch
---

Fix a quadratic key-line scan in `extractJson`.

`lineOf` compiled a fresh `RegExp` per top-level key and ran a full
`lines.findIndex` for each one, so a flat JSON dictionary cost O(keys x lines) —
quadratic in file size. Flat dictionaries are the common case, not an exotic
one: i18n locale files, config maps and data dumps are all one big top-level
object.

Both read paths reach it uncapped or near-capped. `filterOutput` routes any
`.json` file read (`proxy_read_file`, `mega output read`) through
`chunkBySemantic` -> `extractJson`, and `readRaw` applies no size cap;
`mega scan` / `mega index` hit it for every `.json` up to the 1 MB
`DEFAULT_MAX_FILE_SIZE`. Measured through `extractJson` on a realistic locale
shape: 33 ms at 97 KB, 121 ms at 196 KB, 479 ms at 395 KB, 3409 ms at 1061 KB
(~3.5x per doubling). A same-byte-size, same-line-count nested control with one
top-level key cost 5.5 ms at 1061 KB — the cost tracked key count, not size.

Fixed by resolving every key in one pass: a single anchored regex per line
records the first line each key token appears on, and `lineOf` becomes a map
lookup. 7.3 ms at 1061 KB (467x).

Semantics are unchanged, including first-occurrence-wins (a nested key on an
earlier line still beats the top-level key of the same name) and the fallback to
line 1 for keys whose source form is escaped (`"a\"b"`, `"é"`), which the
per-key regex never matched either. Verified by differential comparison of the
old and new resolvers over 40,240 documents — every `.json` tracked in the repo
in both pretty and minified form, 18 adversarial shapes (regex metacharacters in
keys, escaped quotes, trailing backslashes, tab indentation, duplicate keys,
key-like text inside string values), and 20k randomised documents over a hostile
alphabet — 42,068 key lookups, zero divergences.

Guarded by `test/extract-json-quadratic.test.ts`, which drives the exported
function on a 1 MB flat locale file (the shipped scan cap) and compares it to
the same object minified — same keys, same values, so every per-key cost that is
not the defect cancels and only line count differs. One-pass measures 1.10-1.43x
across 192 KB-1 MB; with the fix reverted, 20.5-79.0x. A wall-clock ceiling was
tried first and rejected: the one-pass call is 24 ms idle but 1137 ms inside a
full parallel `pnpm verify`, which leaves no gap below the defect.
