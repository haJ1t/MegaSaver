---
title: A successful stale-lock steal is abandoned at the deadline
status: proposed
risk: HIGH
created: 2026-07-25
package: "@megasaver/shared"
found-by: main CI red since 07a4e3dc (saver-heartbeat E25, saver-seen-concurrency)
---

# Stale-lock steal succeeds, then gives up

> HIGH — `withFileLock` guards every cross-process write in the saver
> paths. A wrong loosening double-runs `fn()`; the current behaviour
> silently drops writes.

## §1 The defect

`withFileLock` removes a stale lock and then re-checks the deadline
*before* retrying the acquire:

```ts
rmSync(lockPath, { force: true });   // steal SUCCEEDED
...
if (Date.now() >= deadline) return false;   // ...gives up anyway
```

It reports "could not lock" immediately after clearing the only thing
that was blocking it. The caller skips its write.

The comment justified the bail as *"staleMs >> deadlineMs, so a stale
lock means the deadline has effectively passed"*. That reasoning holds
only for a steal that **failed**. When the steal succeeded, the lock is
gone and one more O(1) `wx` takes it.

This defeats E25 — *"a crashed writer can never freeze its callers
forever"* — precisely on slow machines, which is when a crashed writer
is most likely.

## §2 Deterministic reproduction

Stale lock (10 s old, `staleMs` 5000), `deadlineMs: 0` — standing in
for "the steal outran its budget":

```
{"acquired": false, "ran": false}
```

The lock file *was* removed. `fn` never ran. Pinned as a test.

## §3 Why it reaches CI — the tail, measured

The steal path costs four syscalls (`open` + `stat` + `stat` + `rm`).
200 samples through the real function:

| condition | p50 | p90 | p99 | max |
|---|---|---|---|---|
| idle | 0.176 ms | 0.489 ms | **29.8 ms** | 39.4 ms |
| 3x core oversubscription | 0.155 ms | 0.262 ms | **39.6 ms** | 50.7 ms |

The median is ~200 µs, but the p99 is ~30–40 ms. Against the shipped
deadlines — **10 ms** (`saver-heartbeat` `LOCK_WAIT_MS`) and **50 ms**
(`saver-seen`) — roughly **1 in 100 steals** succeeds and is then
abandoned, *on an idle machine*. Load widens the tail further.

That rate matches the observed symptom: an occasional red, not a
consistent one.

## §4 What it explains, and what it does not

`main` has been red since `07a4e3dc` on two tests, both in this lock:

- `context-gate/test/saver-heartbeat.test.ts` — *"steals a stale lock
  file instead of skipping forever"*, failing with `expected {} to have
  property "aaaa"`. That empty object is exactly a skipped write.
- `context-gate/test/saver-seen-concurrency.test.ts` — writers skip
  under contention, tripping its vacuous-pass guard
  (`landed.length > 48`).

**Not claimed: that this fix makes those two green.** I could not
reproduce either failure locally — `saver-heartbeat` passed 3/3 under
2x oversubscription *with the fix reverted*. What is established is
that the defect is real, deterministic, and that its failure signature
and measured rate match both symptoms. Whether CI has an additional
cause is unknown until CI runs.

The existing `file-lock` test *"steals a STALE lock and runs fn"* uses
`deadlineMs: 10` and is exposed to the same p99 tail — it has been
passing on luck, not on margin.

## §5 The fix

Bound the **failed** steal, not the successful one:

```ts
if (stolen && ++steals <= MAX_STEALS) continue;
if (Date.now() >= deadline) return false;
```

`MAX_STEALS = 2`. The bound exists for exactly one reason —
termination: a peer recreating the lock with a BACKDATED mtime would
otherwise read as stale forever and spin the loop. That is the hazard
the original unconditional check was reaching for.

The specific value is slack, not science, and the review caught an
earlier draft justifying it with a race that cannot happen: a contender
that wins the `wx` writes a FRESH lock, which is not stealable, so an
ordinary second steal is unreachable and 1 would do. 2 costs nothing —
every removal is still gated by the re-stat equality check — and
exceeding it is not an abort: control falls through to the normal
deadline rules, which skip only once the deadline has passed. Verified
against an adversary recreating a backdated lock in a tight loop: the
call returned in 0.6 ms having stolen and acquired, with no hang.

**Not changed:** `LOCK_WAIT_MS` / the 50 ms `saver-seen` deadline stay
as they are. With the steal path no longer deadline-bound, retuning
them addresses nothing this defect causes.

### What must not regress

Removing a **fresh** lock lets two callers run `fn()` at once — a lost
update, strictly worse than a skipped write. The fix does not touch
that path: the re-stat equality check still gates every `rmSync`, and
`stolen` is only set when that check passed and the removal returned.

## §6 Definition of Done

1. RED first: the `deadlineMs: 0` steal case fails before the fix.
2. The spin guard still holds — a directory at the lock path (rm always
   throws) still returns `false` without hanging.
3. No fresh lock is ever removed.
4. `pnpm verify` green.
5. `critic` pass, fresh context.
6. Changeset (patch), `wiki/log.md`.
