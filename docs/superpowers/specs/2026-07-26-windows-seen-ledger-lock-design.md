# Serialize Windows saver seen-ledger readers

- Status: user-authorized release correction
- Risk: **MEDIUM** — hook-local persistence synchronization; fail-open read semantics retained
- Source: GitHub Actions runs `30210503051` and `30215294810`, Windows jobs
  `89815835263` and `89828358449`

## Problem

The initial repair made readers and writers share the same session lock, which
prevents our own readers from racing the writer. A fresh Windows CI run still
reported `EPERM` from `renameSync` while that lock was held, proving that an
unrelated Windows handle (for example filesystem indexing or endpoint
protection) can reject replacement of this auxiliary ledger. The ledger is
explicitly fail-open: corrupt or missing bytes already mean “not seen” and can
at worst cause one redundant compression.

## Decision

Keep the existing 50 ms, stale-aware lock for both reads and writes, but write
the small JSON ledger directly while the writer holds that lock instead of
renaming a temporary file over it. All product readers use the same lock, so
they cannot observe a partial write. If a process or host interrupts the
write, the existing parser returns an empty ledger on the next read. A direct
write failure is also swallowed locally; the saver hook continues and the only
consequence is redundant compression. This removes the Windows replacement
operation rather than retrying or weakening lock serialization.

## Acceptance criteria

1. A fresh seen-ledger lock makes `hasSeenOutput` return `false`, even for a
   recorded hash.
2. A missing ledger returns `false` before lock acquisition; the lock helper's
   parent-directory precondition therefore cannot impose its 50 ms deadline on
   first use.
3. A test that makes `renameSync` throw still records and reads a hash, proving
   the seen-ledger writer no longer depends on target replacement.
4. The existing real multi-process race test stays green.
5. The full context-gate package, `pnpm verify`, and both CI runners pass.

## Out of scope

No lock timeout change, retry loop, persistence schema, FIFO-cap change, or
change to durable user-facing storage.
