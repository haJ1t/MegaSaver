---
"@megasaver/context-pruner": patch
---

Skip co-change pairing for mass-touch commits in `parseNumstat`.

Pairing is all-pairs within a commit — O(files²) in time AND memory — and
nothing capped commit width ahead of it. One wide commit inside the
1000-commit `readCoChangeLog` window (initial import, vendored deps drop,
repo-wide formatter run, generated client) dominated the whole parse, and every
`mega context pack` / MCP context-pruning call pays it on the first pack build
in a process (`score.ts`'s memo only avoids re-paying it within one process).

Measured on `parseNumstat` with one commit of N files, node v25.8.2: 1000 files
(25 KB) 75 ms / 142 MB RSS, 2000 files (51 KB) 344 ms / 370 MB, 4000 files
(103 KB) **2256 ms / 960 MB** — 4-6.5x per doubling while the input bytes only
double, so ~8-10k files in one commit is OOM, not just slow. After the cap the
same 4000-file commit parses in **1 ms / 74 MB**.

A commit touching more than 50 files carries no co-change signal anyway —
"everything changed with everything" is noise, and it inflates `peak`, the
normalizer for every other pair. Its rows still contribute churn; only its
pairs are skipped. On this repo's own 874-commit history the cap drops 18
commits (2%) and 57% of the pair entries, leaving the strongest pairs and their
normalized strengths intact (top-10 identical, e.g. 1.00, 0.43 -> 0.41,
0.32 -> 0.31).
