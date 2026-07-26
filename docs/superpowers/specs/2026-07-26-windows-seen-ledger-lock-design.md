# Serialize Windows saver seen-ledger readers

- Status: user-authorized release correction
- Risk: **MEDIUM** — hook-local persistence synchronization; fail-open read semantics retained
- Source: GitHub Actions run `30210503051`, Windows job `89815835263`

## Problem

The same-session saver ledger serializes writers through a lock file but lets
`hasSeenOutput` read its JSON file without that lock. On POSIX, an atomic rename
can replace a file held open by a reader. Windows rejects that rename with
`EPERM`, so concurrent hooks can terminate a writer and fail CI.

## Decision

Use the existing 50 ms, stale-aware lock for both reads and writes of a
session's seen ledger. A reader that cannot acquire the lock returns `false`,
which preserves the documented fail-open contract: it may cause redundant
compression, but never blocks a tool call or reads through an active writer.

## Acceptance criteria

1. A fresh seen-ledger lock makes `hasSeenOutput` return `false`, even for a
   recorded hash.
2. A missing ledger returns `false` before lock acquisition; the lock helper's
   parent-directory precondition therefore cannot impose its 50 ms deadline on
   first use.
3. The existing real multi-process race test stays green.
4. The full context-gate package, `pnpm verify`, and both CI runners pass.

## Out of scope

No lock timeout change, retry loop, persistence schema, or changes to the
500-entry FIFO policy.
