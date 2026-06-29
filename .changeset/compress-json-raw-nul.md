---
"@megasaver/output-filter": patch
---

fix: remove raw NUL bytes from the compressJson source

`compress/json.ts` used a literal NUL byte as the key-set join separator, so the
file contained raw `0x00` bytes. git and `@megasaver/indexer`'s `scanRepo`
correctly classify any NUL-bearing file as binary and skip it, so json.ts never
entered the index and `searchBlocks` could not return its blocks (a silent
recall gap). The separator is now written as a unicode NUL escape sequence —
identical NUL separator at runtime, ASCII source file. The scanner's NUL
heuristic is correct and unchanged; a regression guard asserts every `src/*.ts`
is NUL-free, and indexer scan tests pin that high-bit (non-NUL) UTF-8 sources
are scanned while NUL-bearing files stay flagged binary.
