---
"@megasaver/output-filter": patch
---

fix(output-filter): outline read falls back when skeleton would not save context

`mega_read_file { outline: true }` now only returns the skeleton when it is
meaningfully smaller than the raw file (skeleton bytes < 0.9 × raw bytes). On
tiny or dense/minified files the signature skeleton can equal or exceed the
raw bytes; in that case the read falls through to the normal rank/fit pipeline
instead of returning a payload larger than a plain read. Lossless either way.
