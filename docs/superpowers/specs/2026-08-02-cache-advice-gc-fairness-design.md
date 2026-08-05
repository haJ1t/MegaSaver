# Cache-Advice Fair GC and Migration Amendment

> **Date:** 2026-08-02
> **Status:** APPROVED — the user authorized continuous implementation until completion on 2026-08-02.
> **Risk:** HIGH — this changes private state topology, retention, crash recovery, and an internal maintenance process.
> **Amends:** 2026-08-02-batch-read-adviser-hardening-design.md §§2.1–2.3 and 2026-08-02-batch-read-adviser-hardening-plan.md.

## 1. Trigger

The bounded flat-directory cache-advice sweep can repeatedly inspect the same
early entries. A later expired state can therefore starve indefinitely under
continuous activity, contradicting the 30-day retention contract. A last-name
cursor that rescans from the beginning is still unbounded, and fixed hash
shards only make starvation unlikely. Neither is acceptable.

This amendment changes only private cache-advice state and retention. It does
not expand command permissions, inspect tool content, or establish a
cost-savings claim.

## 2. Decisions

### 2.1 Opaque v3 capsules and durable FIFO

On POSIX, new state lives under a private stats/cache-advice-v3 root. The v3
label is the storage topology; a successfully migrated batch-read snapshot
remains strict JSON state version 2 until a later explicit schema amendment.

The runtime derives recordId as a domain-separated SHA-256 hash of the current
workspace key and safe-session storage key. It is the only record identity
outside a capsule. No raw workspace, cwd, session, tool input, or command is
written.

    stats/cache-advice-v3/
      records/<recordId[0..1]>/<recordId[2..3]>/<recordId>/
        state.json | suppression.json
        state.lock
        .<uuid>.tmp
      queue/work.log
      queue/control.json
      queue/.queue.lock
      migration.json
      .migration.lock
      .gc.lock

Every node is owner-private. State, lock, queue, control, and
temporary nodes require lstat, a no-follow/nonblocking descriptor open, fstat,
regular-file/single-link validation, private ownership/mode checks, byte
bounds, and identity rechecks before replacement or unlink. Symlinks, FIFOs,
devices, directories, hard links, malformed metadata, and unexpected names
fail closed. Windows creates none of these nodes and returns empty advice.

Queue work.log holds fixed-width opaque record frames and is capped at
1,048,576 bytes. At the cap a new enrollment suppresses advice and requests
off-hook maintenance; it never makes an unbounded hook write. control.json holds only
format/version, bounded byte offsets, an optional inflight offset, an optional
frozen sweep-tail offset, and daily/clock-cut timestamps.

**Accepted simplification (review amendment):** the implementation uses a
single append-only JSONL work log (`queue/work-1.jsonl`) plus the durable
`control.json` head/inflight/sweep-tail offsets instead of a separate
`transition.json` write-ahead record and fixed-width frames. The head +
inflight replay in `control.json` is the WAL: a claim durably records the
inflight byte offset before the frame's effect, and a crash replays it before
any new claim — the same recovery guarantee `transition.json` was specified
for, with one fewer file to keep consistent. All appends and control
replacements are fsynced (new-file + fsync + rename + parent-directory fsync)
before making their effect reachable. Deletions and timestamp normalizations
fsync the parent directory after the unlink/futimes so the directory entry is
durable across a crash.

Only the off-hook maintainer may compact fully consumed work-log bytes: under
the no-wait queue lock it rewrites the log keeping only frames at or after the
durable head offset and shifts every control byte offset by the removed
prefix, via a durable new-file + fsync + rename + parent-directory fsync. It
never compacts around an inflight frame, so a crash mid-compaction leaves
either the old or the new log/control pair fully readable. This keeps the
capped append-only log from permanently silencing new enrollments at the
ceiling.

Before creating a new capsule, a transaction must take the no-wait queue lock
and durably append its record ID. A crash between enrollment and capsule
creation leaves an orphan opaque frame that GC can skip; a live capsule cannot
exist without a reachable frame. Queue contention or unsafe metadata suppresses
optional advice without state creation. Existing capsule updates do not enqueue
again.

### 2.2 Bounded fair retention and clocks

The daily sweep never enumerates records. It takes the no-wait global GC lock
and processes at most eight FIFO frames per hook. At the start of an incomplete
sweep it durably freezes the current tail. New enqueues and requeues land
behind that sentinel; the daily marker advances only when the frozen tail has
been processed.

For each head frame, the sweeper durably records inflight state, securely
checks only its exact capsule, then either:

- securely deletes an expired trusted node and fsyncs its parent;
- requeues a fresh, active-lock, future-dated, corrupt, or unsafe node before
  advancing the head;
- advances over a missing capsule or orphan frame without deletion.

Recovery replays a bounded transition before a new claim. It may see a missing
capsule after delete-before-cursor crash or a duplicate opaque frame after
requeue-before-cursor crash; it may never advance a cursor before durable
delete/requeue makes the frame reachable.

For N frames frozen at sweep start, no more than ceil(N / 8) later successful
hook batches reach the sentinel. Continuous writers and hot requeues are
behind it and cannot starve a stale earlier record. This liveness condition
requires later hooks to reach a private writable local store; no process can
delete data when the machine stops receiving hooks or loses disk access.

Missing daily state, a backwards clock, or a forward jump larger than two days
writes a durable clock-cut baseline and performs no deletion in that batch. A
future marker or target is normalized through that baseline, so it cannot
throttle cleanup forever. A target is eligible only when its verified timestamp
is strictly older than now minus 30 days. Clock cuts never cause early deletion.

Only the off-hook maintainer may compact fully consumed work-log segments by a
durable new-log/control replacement. The hook never reads, rewrites, or
enumerates an unbounded queue or directory.

### 2.3 One-time off-hook legacy migration

An arbitrary v2 flat tree cannot be exhaustively discovered by a bounded
portable directory iterator. While migration is incomplete, the v3 hook never
reads or writes the legacy flat tree, returns empty advice output, and may
best-effort trigger the internal mega hooks cache-advice-maintain worker.
Failure to spawn is a safe false negative, never a synchronous slow path.

The worker runs outside PreToolUse under a no-wait migration lock and performs
an exhaustive descriptor-safe legacy walk. It is restart-idempotent:

- a valid v2 snapshot is FIFO-enrolled before it moves into its capsule, with
  offered keys, recent calls, and retained timestamps preserved;
- v1, malformed, oversized, and unknown-version snapshots are not parsed or
  reset. The worker writes an opaque expiry suppression capsule based on the
  verified legacy timestamp, then removes only the exact trusted legacy node;
- old locks and strictly shaped transaction temporaries enter the same expiry
  decision; arbitrary or unsafe nodes are not followed or deleted;
- migration-complete is atomically written only after a final clean rescan.
  A crash before it simply repeats idempotent checks later.

hooks install invokes the maintainer outside the hook path if legacy state
exists. The runtime trigger is single-flight and detached, invokes only the
current internal CLI entry point, and never prints or persists its store path.
New binaries write only v3 capsules. An observed legacy reappearance reopens
migration before a clean completion; operators must update all installed hook
binaries before the worker can make a final clean migration.

### 2.4 Unchanged boundaries

Batch-read advice remains at most once per canonical directory key per
canonical workspace and safe session. It preserves canonical-realpath and NFC
hashing rules, 65,536-byte stdin and 4,096-byte path bounds, the 32,768-byte
state ceiling, and advice-only output. It does not add permissionDecision,
updatedInput, or any Task Kickoff change.

The behavioral API A/B remains a separate no-claim gate. Queue activity and
advice-event counts are not cost-reduction evidence.

## 3. Acceptance evidence

- More than 64 fresh or unsafe early records cannot prevent a late expired
  record from deletion in finite eight-frame batches; continuous producers stay
  behind a frozen-tail sentinel.
- Crash cuts around enrollment, claim, requeue, delete, cursor advance,
  compaction, and migration leave a reachable frame or safe suppression.
- A legacy tree with more than 64 nodes migrates over restarts, preserves valid
  v2 state, turns v1/malformed input into opaque suppression, and copies no raw
  path, session, command, prompt, URL, or secret.
- 29-day, exactly-30-day, older-than-30-day, future timestamp, backwards clock,
  and large-forward-clock behavior never deletes early or throttles forever.
- Unsafe queue/control/capsule nodes safely suppress or skip; Windows creates
  no v3 root, queue, marker, worker state, or advice.
- Task Kickoff state stays untouched; fresh bundle and packed bin cover the
  POSIX path; Node 22 pnpm verify and independent code-reviewer plus critic
  pass.
