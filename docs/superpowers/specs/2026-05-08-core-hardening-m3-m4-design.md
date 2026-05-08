---
title: core hardening — M3 stale-lock detection + M4 NFC normalization
date: 2026-05-08
risk: HIGH
status: draft
authors: [claude]
related:
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - wiki/entities/core.md
---

# core hardening — M3 + M4

## §1 Goal & scope

Two cohesive correctness fixes for `@megasaver/core`, shipped together
in one PR:

- **M3 — Stale-lock detection.** `withDirLock` in
  `packages/core/src/json-directory-registry.ts` currently waits the
  full 5-second acquire timeout when a previous holder crashed and
  left an orphan `.projects.lock` file. After this slice the helper
  detects a dead holder via PID-in-lock-file plus
  `process.kill(pid, 0)` and recovers immediately.
- **M4 — Unicode NFC normalization.** `Project.name` and
  `Session.title` Zod schemas gain a parse-time `.transform(s =>
  s.normalize("NFC"))` so identity strings have a single canonical
  byte representation. Visually identical inputs that differ only in
  Unicode composition (e.g. NFC `café` vs NFD `café`) are
  treated as the same string post-parse.

Both fixes were tracked as v0.1 residual risks (M3 from PR #5
follow-ups, M4 from PR #5 unicode-policy gap). Neither blocks v0.1
shipping but both prevent latent correctness bugs that get harder to
fix once `projects.json` is in the wild.

Risk: **HIGH** per `CLAUDE.md` §12 — `@megasaver/core` is the
agent-agnostic foundation, public surface, and persistence
boundary. Worktree mandatory; full superpowers chain plus
`architect` design review and `critic` adversarial review.

Out of scope (explicitly deferred):

- Cross-host lock semantics (NFS, multi-machine) — host check would
  require hostname in the lock payload; v0.2.
- `Project.rootPath` and `MemoryEntry.content` normalization —
  rootPath is OS-managed (APFS, ext4, NTFS each have their own
  policy); content is opaque user payload.
- Lock acquire-time stamping or aging logic — extra fields invite
  clock-skew bugs without proportional benefit at v0.1 scale.
- Eager NFD-to-NFC migration of existing on-disk entries — handled
  lazily on next read/write rather than via a one-shot compactor.

## §2 M3 — stale-lock detection

### Current behaviour

`packages/core/src/json-directory-registry.ts:29-60` (after PR #9
M1):

```ts
function withDirLock<T>(rootDir: string, fn: () => T): T {
  const lockPath = join(rootDir, ".projects.lock");
  const deadline = Date.now() + 5000;
  let fd: number | undefined;
  while (Date.now() < deadline) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new CorePersistenceError(
          "store_write_failed",
          "Failed to acquire registry lock.",
          { cause: err, filePath: lockPath },
        );
      }
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 50);
    }
  }
  if (fd === undefined) {
    throw new CorePersistenceError(
      "store_write_failed",
      "Timed out acquiring registry lock.",
      { filePath: lockPath },
    );
  }
  try {
    return fn();
  } finally {
    try { closeSync(fd); } catch {}
    try { rmSync(lockPath, { force: true }); } catch {}
  }
}
```

The current implementation writes nothing into the lock file when
it acquires; the file is a pure existence-only marker. When the
holder crashes, the file persists. The next caller hits `EEXIST`,
sleeps 50 ms, retries, hits `EEXIST` again, ... until the 5-second
deadline expires and `store_write_failed` is thrown. Recovery
requires manual `rm`.

### New behaviour

1. **On successful acquire**: after `openSync(lockPath, "wx")`
   returns the file descriptor, write the current PID into it
   immediately, then close-and-keep-the-name as today:

   ```ts
   fd = openSync(lockPath, "wx");
   writeSync(fd, String(process.pid));
   // (keep fd until release; current code keeps it for symmetry)
   ```

2. **On `EEXIST`**: probe the existing lock file before sleeping:

   ```ts
   if (!isLockHolderAlive(lockPath)) {
     try {
       rmSync(lockPath, { force: true });
       continue; // reclaim succeeded — immediate retry, skip backoff
     } catch {
       // reclaim failed (e.g. permission denied) — fall through to backoff
     }
   }
   const buf = new Int32Array(new SharedArrayBuffer(4));
   Atomics.wait(buf, 0, 0, 50);
   ```

3. **`isLockHolderAlive`** (new private helper, NOT exported):

   ```ts
   function isLockHolderAlive(lockPath: string): boolean {
     let raw: string;
     try {
       raw = readFileSync(lockPath, "utf8");
     } catch {
       // lockfile vanished between EEXIST and read — treat as gone
       return false;
     }
     const pid = Number.parseInt(raw.trim(), 10);
     if (!Number.isInteger(pid) || pid <= 0) {
       // malformed payload — treat as stale, reclaim
       return false;
     }
     try {
       process.kill(pid, 0);
       return true;
     } catch (err) {
       if ((err as NodeJS.ErrnoException).code === "ESRCH") {
         return false; // confirmed dead
       }
       // EPERM (process exists but signal blocked), other → conservative alive
       return true;
     }
   }
   ```

### Race window analysis

- **Acquire vs. write race**: between `openSync(wx)` succeeding and
  `writeSync(fd, pid)` running, the file exists but is empty. A
  concurrent caller in the EEXIST branch might `readFileSync` the
  empty file, parse `NaN`, and consider the lock stale. They would
  then `rmSync` and try to acquire — but the original holder still
  has `fd`, and `openSync(wx)` on the same path will succeed for
  the racer because the file is gone. Two holders.
  - **Mitigation**: write happens immediately after openSync within
    the same scope (sub-millisecond). Race window is bounded by JS
    event-loop scheduling, not user-mode logic. v0.1
    single-developer scale tolerates this; the next caller almost
    certainly hits the EEXIST after the write completes.
  - Future hardening (R3 below): `writeFileSync(lockPath, pid, {
    flag: "wx" })` is a single syscall that opens-and-writes
    atomically. Worth migrating to but requires verifying behaviour
    on every supported FS (APFS, ext4, NTFS-via-WSL) before
    relying on the atomicity. Deferred.

- **PID reuse race**: `process.kill(pid, 0)` checks the PID at
  call time. If the OS reaped the original holder and assigned the
  same PID to an unrelated process, `kill(0)` returns success →
  conservative "alive" decision → 5s timeout → `store_write_failed`.
  Same outcome as the pre-M3 behaviour. Fail-safe.

- **Lock-file vanish race**: between EEXIST and `readFileSync`, the
  holder may have released the lock and removed the file. `readFileSync`
  throws ENOENT → `isLockHolderAlive` returns false → `rmSync` no-op
  (file already gone) → retry → `openSync(wx)` succeeds. Correct.

### Errors

No new error code. `store_write_failed` (acquire timeout) and
`store_read_failed` (other unexpected I/O) codes are unchanged.
`isLockHolderAlive` swallows read-time errors as "stale" rather
than surfacing them — the function's job is to answer "is the
holder demonstrably alive?" and absence of evidence is treated
the same as confirmed death (cleared and retried).

### Public API

`isLockHolderAlive` is a private function in
`json-directory-registry.ts`. It is **not** added to the package
`exports`. The PID-in-lockfile convention is implementation detail.
Any future change (e.g. JSON payload, hostname inclusion) is
internal.

### Test plan

Three new cases in `packages/core/test/json-directory-registry-lock.test.ts`
(extending the existing 2 cases from PR #9 M1):

| Test | Setup | Expectation |
|---|---|---|
| recovers when a stale lock contains a dead PID | `writeFileSync(lockPath, "99999999")` (PID guaranteed not alive) | `createProject` succeeds; elapsed time well under 5s; lock file is removed after success. |
| times out when the lock holder PID is alive | `writeFileSync(lockPath, String(process.pid))` (current process always alive) | `createProject` blocks for 5s and throws `store_write_failed`. Confirms PID-reuse fail-safe is the worst case (same as pre-M3 behaviour). |
| recovers when a stale lock has malformed payload | `writeFileSync(lockPath, "not-a-number")` | `createProject` succeeds quickly; lock content treated as stale. |

The existing 2 lock tests (lock cleanup on success, lock failure
on chmod-restricted root) stay green unchanged.

## §3 M4 — NFC normalization

### Current behaviour

`packages/core/src/project.ts:7`:

```ts
name: z.string().trim().min(1),
```

`packages/core/src/session.ts` `title`:

```ts
title: z.string().trim().min(1).nullable(),
```

No Unicode normalization. NFC `café` (U+00E9) and NFD `café`
(`e` + combining acute) are byte-distinct strings even though they
render identically. This produces:

- Two projects with visually identical names sharing
  `projects.json`, both rejected by humans as "the same name".
- Display drift: depending on which form a user pastes, the listed
  project name shifts shape across `mega project list`.
- Connector block content drifts: `Project: café (id)` vs
  `Project: café (id)` produce byte-different rendered blocks
  even when intent is identical.

### New behaviour

Add a parse-time `.transform()` to both schema fields:

```ts
// project.ts
name: z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.normalize("NFC")),
```

```ts
// session.ts
title: z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.normalize("NFC"))
  .nullable(),
```

### Order of operations

`.trim() → .min(1) → .transform(normalize) [→ .nullable()]`. Why:

- **Trim first**: leading/trailing whitespace is NFC-irrelevant and
  removing it before normalization avoids spurious changes if
  whitespace itself contains rare combining characters.
- **Min(1) second**: empty-string rejection is independent of
  normalization (empty stays empty) but rejecting before transform
  avoids transforming a string we are about to throw on.
- **Transform last**: applies only to validated, trimmed,
  non-empty strings.

### Idempotency

`String.prototype.normalize("NFC")` is idempotent:
`s.normalize("NFC").normalize("NFC")` is observably equal to
`s.normalize("NFC")` for all input strings. A read-then-parse cycle
on already-NFC content is a no-op.

### Migration semantics

Lazy, not eager. The on-disk `projects.json` is **not** rewritten
on upgrade. Behaviour after deployment:

1. **Read path**: `loadProjects → JSON.parse → projectSchema.parse`
   normalizes `name` to NFC in memory. Any consumer (CLI list,
   connector render) sees NFC.
2. **Write path**: `createProject` and any future `update*` write
   the post-parse (NFC) form to disk, replacing the prior NFD entry
   with its NFC equivalent. The disk converges to NFC over time as
   entries get touched.
3. **Mixed disk**: an entry that is never touched again stays NFD
   on disk forever. This is acceptable because reads always
   normalize; the only observable consequence is that the
   `projects.json` file is not byte-uniform.

A future v0.2+ feature `mega project compact` could perform a
one-shot eager migration if disk uniformity becomes important
(e.g. for git-friendly diffs). Deferred — not part of this slice.

### Boundary: which fields are NOT normalized

| Field | Normalize? | Rationale |
|---|---|---|
| `Project.name` | YES | Identity + display string; uniqueness check semantics depend on equality. |
| `Project.rootPath` | NO | Filesystem-managed (APFS, ext4 each have policies); double-normalization risks bug. |
| `Session.title` | YES | Display string; same display-consistency rationale as name. |
| `MemoryEntry.content` | NO | Opaque payload; user may have pasted markdown / code with intentional NFD escapes. |
| Branded UUIDs (`*Id`) | n/a | ASCII-only by schema; NFC no-op. |
| `agentId`, `riskLevel`, `scope` | n/a | Enum literals, ASCII. |
| `createdAt`, `updatedAt`, `startedAt`, `endedAt` | n/a | RFC 3339 timestamps, ASCII. |

### Interaction with sentinel substring rejection

`@megasaver/connectors-shared` `containsSentinel` (PR #9 F10) does
NFKC normalization plus zero-width / bidi / BOM stripping before
substring check. NFC is a strict subset of NFKC (NFKC includes
compatibility decomposition that NFC does not), so a string that
is already NFC-clean is a fortiori NFKC-clean. The sentinel rejection
path is unchanged in behaviour; this slice does not touch it.

### CLI duplicate-name check

`apps/cli/src/commands/project.ts` performs duplicate-name detection
by comparing post-parse names of existing projects against the
incoming new project (also post-parse). Both sides go through
`projectSchema.parse`, so both are NFC. NFD input creates an NFC
post-parse name, which collides with an existing NFC name in
`projects.json` correctly. **No CLI source change required** — the
fix is entirely at the schema layer.

### Test plan

Seven new cases. Three entity-level tests in
`packages/core/test/project.test.ts`, two in
`packages/core/test/session.test.ts`, plus a new file
`packages/core/test/json-directory-registry-normalization.test.ts`
covering registry-level migration semantics:

| File | Test | Assertion |
|---|---|---|
| `test/project.test.ts` | NFC normalize on name | `projectSchema.parse({ ..., name: "café" }).name === "café"` (length 4, code point U+00E9) |
| `test/project.test.ts` | NFC idempotent | parsing twice is byte-equal to parsing once |
| `test/project.test.ts` | rootPath NOT normalized | parsed `rootPath` byte-equal to input |
| `test/session.test.ts` | NFC normalize on title | NFD title input → NFC title output |
| `test/session.test.ts` | null title preserved | `title: null` parses to `title: null` |
| `test/json-directory-registry-normalization.test.ts` | disk migration | Pre-write `projects.json` with an NFD `name` raw (bypassing schema). `listProjects` returns NFC name. Then `createProject` of a different project; re-read disk shows the original entry rewritten as NFC. |
| `test/json-directory-registry-normalization.test.ts` | round-trip create with NFD | Caller passes an NFD `name` to `createProject`. Disk content is NFC. Subsequent `listProjects` returns NFC. |

Total new: 7 tests for M4. Combined with the 3 new M3 lock tests
(see §2), the grand total is 10 new tests; core test count rises
from 96 to 106.

## §4 Implementation packaging

| Package | Change | LOC estimate |
|---|---|---|
| `@megasaver/core` (M3) | Extend `withDirLock` + `isLockHolderAlive` helper in `src/json-directory-registry.ts`. Imports `writeSync`, `readFileSync`. | ~50 |
| `@megasaver/core` (M4) | `.transform()` on `name` in `src/project.ts` and `title` in `src/session.ts`. | ~10 |
| `@megasaver/core` test | 3 lock tests (extend existing file) + 7 normalization tests (extend two existing files + 1 new file). | ~150 |

No CLI source change. No connector source change. No new external
deps. All `node:fs` and `node:process` APIs are first-party.

## §5 Risk, residual, changeset

### HIGH-risk gating (CLAUDE.md §12)

- `@megasaver/core` is the agent-agnostic foundation; every other
  package depends on it.
- M3 changes a concurrency primitive — incorrect implementation
  could allow double-acquire (two processes holding the lock
  simultaneously) or starvation (live process never able to acquire
  because of false-stale recovery).
- M4 changes a parse-time behaviour on user-facing strings — output
  literal is not byte-equal to input literal in the NFD case.

Required:

- Worktree (`.worktrees/core-hardening-m3-m4`).
- Full superpowers chain.
- `architect` design review before plan finalisation.
- `code-reviewer` plus `critic` both Approved on the final commit.
- Author and reviewer agents in separate active contexts.

### Boundary rules

- `isLockHolderAlive` is private. Lock payload format is
  implementation detail; no consumer relies on it.
- M4 does not touch `Project.rootPath` or `MemoryEntry.content`.
  Filesystem normalization is the OS's job; opaque payload is the
  user's.
- No new external deps. All primitives are Node built-ins.
- M3 lock convention is single-host. Cross-host (NFS) consumers
  must not assume PID semantics carry meaning across machines —
  documented residual.

### Accepted residual risks

- **R1** Cross-host (NFS, network filesystem) lock semantics. PID
  validity is a single-host check; on NFS a different host's PID
  is meaningless. v0.1 single-developer single-host scale.
- **R2** PID reuse race. OS may assign a recycled PID to an unrelated
  process between the original holder's death and the next acquire.
  `kill(0)` returns success on the unrelated process →
  conservative "alive" decision → 5s timeout → fall back to existing
  failure path. Same observable outcome as pre-M3.
- **R3** Lock-write atomicity. `openSync(wx)` succeeds, then
  `writeSync(pid)` runs in a separate syscall. A racer reading the
  empty file in between sees an empty payload and treats it as
  stale. Mitigation = sub-ms window. Future option: migrate to
  `writeFileSync(... { flag: "wx" })` for atomic open-write — needs
  cross-FS validation first.
- **R4** Lazy NFD-to-NFC migration. Untouched on-disk NFD entries
  remain NFD on disk; reads normalize them in memory. Eager
  migration deferred to a future `mega project compact` command.
- **R5** `MemoryEntry.content` and `Project.rootPath` are
  intentionally not normalized. Consistency boundary is documented;
  not a bug.
- **R6** Stale-lock detection emits no log notice. Caller (CLI,
  connector, app) is responsible for surfacing observability if
  desired.
- **R7** Atomics.wait sync sleep busy-waits during the 50ms backoff.
  Same as M1; preserved.

### Changeset

- `@megasaver/core`: **patch** — M3 internal recovery (private),
  M4 schema transform (additive, output type unchanged).

The PR description must explicitly call out the M4 input/output
literal-equality change so consumers running tests against literal
expectations notice it. v0.0.0 private package with no external
consumers; no semver impact in practice.

### Definition of done

`CLAUDE.md` §9 plus:

- M3 stale-lock smoke evidence: PID 99999999 lock recovery in <100 ms.
- M4 NFC parse evidence: `projectSchema.parse({ name: "café", ... }).name` equals `"café"` (length 4, code point U+00E9).
- Wiki updates: `wiki/entities/core.md` (M3 + M4 + 106 tests + new PR ref), `wiki/log.md` (PR merge entry).
- `architect` design review approved.
- `code-reviewer` + `critic` opus both Approved at HEAD.
