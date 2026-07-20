---
"@megasaver/cli": patch
---

Fix `mega doctor`'s `saver-liveness` check failing permanently. It scanned every
workspace retained in the heartbeat ledger (30 days) and flagged any with an
invocation and no completion — so a single killed hook in a temp dir, test
fixture, or deleted worktree failed the check until it aged out, with no way to
clear it. Liveness now uses its own 24h recency window, separate from ledger
retention. Genuine current crash/timeout signals still fail; historical
wreckage is ignored.
