---
"@megasaver/context-gate": minor
"@megasaver/content-store": patch
"@megasaver/output-filter": minor
"@megasaver/cli": minor
---

Saver recovery wave 2: hook-compressed output is now stored as uniform
40-line chunks — the recovery footer advertises `N chunks` with fetch-by-id
(`i = 0..N-1`) so an agent expands only the slice it needs instead of
re-paying for the whole raw. The content
store self-cleans: `pruneOlderThan` now recognizes overlay chunk sets (they
previously leaked forever), removes emptied directories, runs best-effort
from the saver hook at most once a day (30-day retention), and is available
manually as `mega output gc [--days N]`.
