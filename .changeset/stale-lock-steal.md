---
"@megasaver/shared": patch
---

Stop abandoning a stale-lock steal that already succeeded.

`withFileLock` removed a stale lock and then re-checked the deadline before
retrying the acquire, so a steal whose four syscalls outran `deadlineMs`
returned `false` having just cleared the only obstacle to the write. The caller
skipped its write.

That defeats E25 — "a crashed writer can never freeze its callers forever" —
exactly on the slow machines where a crashed writer is most likely.

It is not theoretical. Measured over 200 samples of the real steal path: p50
~0.18 ms, but p99 29.8 ms idle and 39.6 ms under 3x core oversubscription,
against shipped deadlines of 10 ms (`saver-heartbeat`) and 50 ms
(`saver-seen`). Roughly 1 in 100 steals succeeds and is then abandoned on an
idle machine.

Now only a FAILED steal is deadline-bounded; a successful one retries the
acquire, bounded by `MAX_STEALS = 2` so a peer recreating the lock with a
backdated mtime cannot spin the loop. The re-stat equality check still gates
every removal, so a fresh lock is never removed and two callers can never run
`fn()` at once.

Deadlines are unchanged. `main` has been red on two lock tests
(`saver-heartbeat` E25, `saver-seen-concurrency`) whose signatures match this
defect, but neither reproduced locally, so this is not claimed as their fix —
only as a real defect with a matching signature and rate.
