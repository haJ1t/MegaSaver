---
"@megasaver/output-filter": minor
---

feat(output-filter): add extractive prose/markdown compressor (WS4)

New `compressProse` function collapses prose/markdown docs extractively:
keeps all headings, first paragraph per section, all fenced code blocks
verbatim, short lists whole, and collapses extra paragraphs/list tails
to counted `… [N paragraphs]` / `… [N more items]` markers.

New `"prose"` OutputCategory with classifier sniff. Checked after
diff/typescript/vitest/structured so it never steals those. Requires
ATX heading as primary signal; `cat *.md` command and fetch-source
content raise confidence independently. Deterministic, no model,
lossless (raw persists to ChunkSet).
