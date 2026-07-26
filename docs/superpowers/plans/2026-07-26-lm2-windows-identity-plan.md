# LM2 Windows Lossless Filesystem Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore verified LM2 durable-memory operation on Windows while
preserving exact POSIX lock and filesystem security checks.

**Architecture:** Persist catalog and workspace lock device/file identities as
canonical decimal strings derived from Node `BigIntStats`; normalize only
canonical, safe legacy persisted identities at read time. Use common
capability helpers for OS-specific mode checks and artifact path spelling.
Keep actual file, descriptor, token, hash, and host-absolute-path validation
at every platform.

**Tech Stack:** Node 22 `fs` BigInt stats, TypeScript strict, Zod, Vitest,
GitHub Actions Ubuntu/Windows matrix.

## Global Constraints

- No Windows test exclusion for LM2 product paths.
- POSIX retains `O_NOFOLLOW`, `O_DIRECTORY`, exact 0600/0700 checks, and
  directory `fsync`.
- Windows omits only unsupported OS capability checks; all object/link,
  descriptor/path, token, and executable-hash checks stay fail closed.
- Catalog identity never passes through JavaScript `number` after collection.

---

### Task 1: Specify platform capability contracts

**Files:**
- Modify: `packages/long-memory/src/lm2-fs-platform.ts`
- Modify: `packages/long-memory/test/lm2-secure-fs.test.ts`
- Modify: `packages/long-memory/src/lm2-benchmark-safe-path.ts`

**Interfaces:** Adds `hasRequiredMode(mode, required, platform)`; returns true
only on Windows capability boundary or exact masked equality elsewhere.

- [ ] Write a failing pure-helper test for Windows `0o777` acceptance and
  Linux rejection, then run the focused secure-fs test and observe the missing
  helper failure.
- [ ] Implement the pure helper and route benchmark mode validation through it.
- [ ] Re-run secure-fs plus benchmark security/transport tests; expect green.

### Task 2: Persist catalog identity losslessly

**Files:**
- Modify: `packages/long-memory/src/lm2-catalog-schema.ts`
- Modify: `packages/long-memory/src/lm2-catalog-lock.ts`
- Modify: `packages/long-memory/test/lm2-catalog-security.test.ts`

**Interfaces:** `catalogLock.device` and `catalogLock.inode` become canonical
nonnegative decimal strings. Lock-local `BigIntStats` comparisons compare exact
`dev`/`ino`; catalog APIs remain unchanged.

- [ ] Add a failing schema/lock test with an identity above
  `Number.MAX_SAFE_INTEGER` and a malformed decimal-string rejection.
- [ ] Convert lock stat reads, control creation, and binding checks to BigInt
  identity text without changing token semantics.
- [ ] Run catalog security/integration/process/runtime matrix tests; expect
  green.

### Task 3: Make benchmark evidence and tool setup portable

**Files:**
- Modify: `benchmarks/longmemeval-v2/evidence-schema.json`
- Modify: `packages/long-memory/test/lm2-completion-integration.test.ts`
- Modify: `packages/long-memory/test/lm2-benchmark-builder.test.ts`
- Modify: `packages/long-memory/test/lm1-paths.test.ts`

**Interfaces:** Absolute artifact schema accepts POSIX `/…` and Windows
`C:\\…`/`C:/…` forms; host runtime still requires `isAbsolute` and matching
hash. The build command chooses `pnpm.cmd` only on Windows.

- [ ] Add focused failing schema/path and command-resolution tests.
- [ ] Implement platform-neutral schema, test command, and unsupported
  directory-sync expectation guards.
- [ ] Run benchmark builder, completion integration, and LM1 path tests.

### Task 4: Verify and release

**Files:**
- Modify: `wiki/log.md`
- Modify: `wiki/agent-channel.md`

- [ ] Run package focused tests and typecheck, then `pnpm verify`.
- [ ] Obtain a fresh independent review of the final diff; repair findings
  under new red/green tests.
- [ ] Commit the scoped repair, push PR #315, and require green Ubuntu and
  Windows verify/bundle-smoke checks before rebase-merging.

### Task 5: Extend lossless identity to the index fence

**Files:**
- Modify: `packages/long-memory/src/lm2-fs-platform.ts`
- Modify: `packages/long-memory/src/lm2-lock.ts`
- Modify: `packages/long-memory/src/lm2-ledger-recovery.ts`
- Modify: `packages/long-memory/src/lm2-quota-ledger.ts`
- Modify: `packages/long-memory/src/lm2-vector-sidecars.ts`
- Modify: focused lock, quota-ledger, and index-operation tests

**Interfaces:** `WorkspaceIndexLockGuard.identity`, `Lm2OperationFence`, and
quota-ledger `lockIdentity` fields use canonical decimal strings. Legacy
numeric catalog controls and quota ledgers are accepted only when their values
are exact nonnegative safe integers, then normalized; unsafe legacy values
fail closed.

- [ ] Add red tests for lossless identity conversion and legacy durable-state
  normalization/rejection.
- [ ] Route workspace lock acquisition and integrity checks through BigInt
  descriptor/path observations; propagate the text identity through fences.
- [ ] Implement the narrow canonical legacy parser and verify the next ledger
  write serializes text identities.
- [ ] Re-run lock, ledger, index-operation, catalog, and full package tests.

### Task 6: Close remaining real-Windows benchmark and fixture boundaries

**Files:**
- Modify: `packages/long-memory/src/lm2-benchmark-safe-path.ts`
- Modify: `packages/long-memory/src/lm2-benchmark-files.ts`
- Modify: `packages/long-memory/test/lm2-benchmark-safe-path.test.ts`
- Modify: `packages/long-memory/test/lm2-benchmark-builder.test.ts`
- Modify: `packages/long-memory/test/lm1-paths.test.ts`
- Modify: `packages/long-memory/test/lm2-catalog-process-fixtures.ts`

**Interfaces:** Benchmark directories use an `opendirSync` handle on Windows,
with pre-open/post-open lossless identity equality and later revalidation
rather than an unavailable directory file descriptor. Regular benchmark files
retain descriptors and the run lock retains its advisory lock. Fixture
protocols parse the first platform-neutral line, and Windows command scripts
run through its command shell.

Windows regular-file opens omit only the unsupported `O_NONBLOCK` flag; POSIX
retains it to prevent FIFO stalls. The replacement-writer child returns by
natural stdout drain rather than forcing process exit before its JSON result
is flushed.

- [ ] Write red simulated-Windows directory-handle/replacement tests,
  including a replacement during `opendirSync` that mimics a lossy-number
  collision.
- [ ] Use the `Dir` handle with exact BigInt identity rechecks, while retaining
  descriptor checks, regular-file `fsync`, and flock for regular files.
- [x] Correct Windows-only fixture expectations without masking file
  durability, CRLF framing, symlink checks, or regular-file identity checks.
- [ ] Run targeted suites, package typecheck, root verify, fresh review, and
  replacement Ubuntu/Windows CI before merge.

### Task 7: Flush exclusive benchmark state through a writable descriptor

**Files:**
- Modify: `packages/long-memory/src/lm2-benchmark-files.ts`
- Modify: `packages/long-memory/test/lm2-benchmark-files-security.test.ts`

**Interfaces:** The exclusive state writer uses the existing safe `update`
open mode before its required file `fsync`; no public transport or persistence
schema changes.

- [x] Add a red test that observes exclusive state being opened read-only and
  requires the update descriptor before durability flush.
- [x] Reopen exclusive benchmark state with `update` before `fsync`.
- [ ] Run the focused benchmark/file suites, package typecheck, root verify,
  independent review, and replacement Ubuntu/Windows CI.
