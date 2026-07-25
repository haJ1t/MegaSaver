---
"@megasaver/content-store": patch
"@megasaver/context-gate": patch
"@megasaver/cli": patch
---

Stop the retention prune from deleting raw chunks that pinned or `manual_hold`
evidence still points at.

`pruneOlderThan` deleted every chunk set older than the window purely by
`createdAt`, while the evidence ledger exempts pinned/`manual_hold` records from
GC. On day 31 the hook GC (and `mega output gc`) deleted the chunk and left the
record `available` with `rawExpandable: true` — the one evidence class a user
explicitly protected became a dead pointer, and any expand on it failed.

`pruneOlderThan` now accepts `keepChunkSetIds`, and the new
`pruneChunkSetsHonoringPins` (context-gate, the package that already composes
content-store + evidence-ledger) joins the two stores and supplies the exempt
ids. Both CLI prune call sites use it. A corrupt ledger aborts the prune instead
of pruning blind.
