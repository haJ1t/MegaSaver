---
title: GG — Real Windows durability for atomicWriteFile (design)
risk: HIGH
status: draft
created: 2026-05-10
updated: 2026-05-10
supersedes:
  - docs/superpowers/specs/2026-05-10-windows-port-deferral.md (§1 fsync only)
related:
  - packages/core/src/json-directory-store.ts
  - packages/core/test/json-directory-store.test.ts
  - docs/superpowers/specs/2026-05-10-dd2-bb-hardening-design.md
  - docs/superpowers/specs/2026-05-10-windows-port-deferral.md
---

# GG — Real Windows durability for `atomicWriteFile` (design)

## §0 TL;DR

Replace v0.2's reactive "swallow `EISDIR`/`EPERM`/`ENOTSUP` on
directory fsync" with a **proactive platform-aware** durability
path that is correct-by-construction on Windows:

1. **Data fsync (step 1)** — keep unchanged. Node's `fs.fsyncSync`
   on Windows resolves to `FlushFileBuffers` via libuv; it works
   on a regular file handle and any error is a real durability
   failure that must propagate on every platform.
2. **Directory fsync (step 3)** — **skip on Windows**. POSIX
   directory-fd `fsync` semantics do not exist on Windows; NTFS
   journals metadata operations so a successfully-returned
   `rename` is durable without a caller-side flush. Branch on
   `process.platform === "win32"` and never open the directory
   as a file handle on Windows.

Net behavioural change on Windows: identical on the happy path
(no syscall vs. caught-then-swallowed syscall), but **any future
genuine `EPERM` from a sandbox / antivirus** now propagates as a
real `store_write_failed` instead of being silently swallowed.

Net behavioural change on POSIX (macOS / Linux): zero. Same
code path. Same syscalls. Same tests pass.

Risk **HIGH** — touches Core durability semantics. Critic review
mandatory pre-merge.

## §1 What v0.2 ships (the problem we are replacing)

`packages/core/src/json-directory-store.ts` (lines 257-274 at
HEAD `480ec8c`):

```ts
// Windows-friendly degradation: fsync on a directory fd may throw
// EISDIR/EPERM/ENOTSUP on some filesystems. Swallow only those known
// codes on the *directory* fsync; data fsync errors propagate.
let dirFd: number | undefined;
try {
  dirFd = openSync(parentDir, "r");
  fsyncSync(dirFd);
} catch (dirErr) {
  const code = (dirErr as NodeJS.ErrnoException).code;
  if (code !== "EISDIR" && code !== "EPERM" && code !== "ENOTSUP") {
    throw dirErr;
  }
} finally {
  if (dirFd !== undefined) {
    try {
      closeSync(dirFd);
    } catch {
      // Ignore close errors; the data is already on disk.
    }
  }
}
```

### Why this is structurally wrong

1. **Conflates Windows with sandboxes.** `EPERM` on a directory
   fsync can also surface from a Linux sandbox (Docker capability
   drop, seccomp) or macOS SIP. Swallowing it on every platform
   hides a real durability regression.
2. **Tests itself, not the system.** The error-swallow branch is
   only exercised when the syscall actually fails, which never
   happens on Mega Saver's macOS / Linux CI. Production Windows
   behaviour is *asserted by reading the code*, not by tests.
3. **EISDIR check is for the wrong primitive.** On Windows,
   `openSync(dir, "r")` itself fails with `EISDIR` before we even
   reach `fsyncSync` — i.e. we're catching the wrong syscall's
   error. The catch happens to cover the right case, but by
   accident.
4. **Comment claims "Windows-friendly degradation"** but the code
   is platform-agnostic try/catch. Reader has to know Win32
   semantics to verify correctness.

## §2 Decision matrix (alternatives considered)

| Option | Win durability | POSIX impact | Test surface | Verdict |
|--------|----------------|--------------|--------------|---------|
| **A**: Keep error-swallow | Reduced (no dir flush) | Hides sandbox EPERM | Untested branch | **Reject** — v0.2 status quo |
| **B**: Branch on `process.platform === "win32"`, skip dir fsync | Reduced (no dir flush) | Zero | Mockable via `process.platform` injection | **Accept** |
| **C**: Branch + use Win32 `FlushFileBuffers` on a CreateFile-opened dir handle | Full | Zero | Requires native bindings / FFI | Reject — out of scope; no native deps in v0.3 |
| **D**: Branch + post-rename `fsync` of a *file* in the parent dir | Theoretical (NTFS journals already cover this) | Adds syscall | Hard to test | Reject — superstition, no POSIX/NTFS doc backs it |

### Why Option B

**B is correct-by-construction.** On Windows:

- NTFS metadata journal flushes on transaction commit; a
  `rename` returning success means the link is durable against
  process crash and kernel panic on NTFS (the only filesystem
  Mega Saver supports on Windows; FAT32 / exFAT are out of scope
  for v0.3 same as v0.2).
- `FlushFileBuffers` on a directory handle is a no-op on NTFS
  (documented in SQLite "How To Corrupt An SQLite Database
  File" §5.0 and the SQLite VFS WAL code).
- Therefore: skipping the dir fsync on Windows is the **same
  durability** as performing it. We're not degrading; we're
  removing a syscall that has no effect.

On macOS / Linux, the dir fsync is required (ext4, xfs, APFS
all need the parent-dir flush for the rename to be durable
against power-loss for ext4 / xfs and against kernel panic for
APFS). Option B preserves this exactly.

### Architectural cross-check

`apps/cli/src/commands/doctor.ts` already establishes the
project pattern for platform branching:

```ts
export function checkPlatform(platform: NodeJS.Platform = process.platform): Check {
```

Same shape: take `NodeJS.Platform` as a parameter with a default,
so tests can inject `"win32"` without `vi.stubGlobal`. We mirror
that exactly.

## §3 Implementation

`packages/core/src/json-directory-store.ts`:

### §3a Extract the platform decision

Add a module-level constant captured at module load:

```ts
const IS_WIN32 = process.platform === "win32";
```

Rationale: `atomicWriteFile` is on the hot path; reading
`process.platform` once at module load is faster than per-call.
And `process.platform` is immutable for the lifetime of the
process, so caching is safe.

### §3b Replace the try/catch with a branch

```ts
// POSIX directory fsync: required on ext4/xfs/APFS for the rename
// metadata to be durable against kernel-panic / power-loss. On
// Windows (NTFS), the rename's metadata is journaled and durable
// without a caller-side flush; `FlushFileBuffers` on a directory
// handle is a documented no-op, and `openSync(dir, "r")` itself
// fails with EISDIR. We branch rather than try/catch so a real
// EPERM from a sandbox surfaces as a durability failure on all
// platforms instead of being silently swallowed.
if (!IS_WIN32) {
  const dirFd = openSync(parentDir, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}
```

Notes:

- No more error swallowing. Any error from `openSync` /
  `fsyncSync` / `closeSync` propagates and becomes a
  `store_write_failed` via the outer catch.
- `closeSync` errors now propagate (previously swallowed). The
  data is durable from the temp file's fsync; a close failure
  is a real syscall problem worth surfacing.
- Symmetric with the temp-file fsync block (`try/finally` close).

### §3c No public API change

`atomicWriteFile` remains internal (`function`, not exported).
No package surface change. No changeset needed.

## §4 Test strategy

CI runs on macOS + Linux only (per v0.2 spec). We cannot
execute the Windows code path. We **can** assert it is correct
by construction:

### §4a Unit test — POSIX path (regression)

The existing test
`packages/core/test/json-directory-store.test.ts` →
`"fsyncs the temp file before rename and the parent dir after rename"`
already pins the POSIX ordering: open(temp) → fsync(temp) →
rename → open(dir) → fsync(dir). This test continues to pass
unchanged on darwin / linux runners. **No edit needed; it
guards the regression.**

### §4b Unit test — Windows path (new)

New test in the same file:

```ts
describe("atomicWriteFile — Windows path (GG)", () => {
  it("skips directory fsync on win32", () => {
    // Stub the win32-detection module to return win32, then
    // assert openSync is called once (for the temp file) and
    // fsyncSync is called exactly once (the temp file), never
    // a second time on the parent directory.
  });
});
```

Implementation: we extract the platform detection into a tiny
module (or use `vi.stubEnv` / `Object.defineProperty` on
`process.platform`). Decision: **expose a `__setPlatformForTest`
seam is the wrong shape** (production code carrying a test-only
hook is an anti-pattern per §13). Instead, use Node's standard
test idiom:

```ts
const ORIGINAL_PLATFORM = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: ORIGINAL_PLATFORM });
});

it("skips directory fsync on win32", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });

  // Re-import the module so the IS_WIN32 module-load constant
  // picks up the stubbed platform.
  vi.resetModules();
  const { writeSessions } = await import("../src/json-directory-store.js");

  // ... run writeSessions; spy on openSync; assert no
  //     `open:<parentDir>` call after the rename.
});
```

This validates the win32 branch end-to-end on a macOS / Linux
host: the stub + dynamic import gives us the same module
behaviour Windows users get.

### §4c Why we don't run real Windows CI

Adding a Windows GitHub Actions runner is the v0.3 FF Windows
port's other open item (CRLF normalization, case-insensitive
resolution, lock semantics). Those are independent of fsync;
this spec ships fsync correctness as a *prerequisite* but does
not pull in Windows CI itself (still on the v0.3 backlog).

The unit test in §4b gives us **correct-by-construction**
assurance: the platform branch is exercised in test on every
PR, and the fsync syscall is documented-correct by NTFS
semantics. The remaining residual risk (NTFS misbehaviour under
adversarial conditions) is the same risk SQLite ships with
millions of Windows installs.

## §5 Migration: supersedes deferral spec §1

`docs/superpowers/specs/2026-05-10-windows-port-deferral.md` §1
("fsync durability — graceful degradation") is superseded by
this spec. The other sections (§2 case-insensitive filesystems,
CRLF normalization, lock semantics, full audit, Windows CI gate)
remain deferred to v0.3.

Action: update the deferral spec frontmatter and §1 to point at
this spec; do not delete the deferral spec (other items still
live).

## §6 Wiki updates

Append to `wiki/log.md` under today's date:

```
## [2026-05-10] schema | GG real Windows durability — fsync platform branch
```

Update `wiki/index.md` Status § to note v0.3 GG ships;
deferral entry for FF v0.3 narrows to non-fsync items only.

## §7 Out of scope

- Windows CI runner (v0.3 separate work item).
- `F_FULLFSYNC` on macOS (out per v0.2 BB spec §1).
- Native FFI bindings for `FlushFileBuffers` on a directory
  handle (Option C — out per §2).
- Case-insensitive path resolution audit (v0.3 separate).
- CRLF line ending normalization (v0.3 separate).
- Lock-file semantics audit (v0.3 separate).
- Non-NTFS Windows filesystems (FAT32 / exFAT — out, same as
  v0.2).

## §8 Tests delta

- **+1 test** in `packages/core/test/json-directory-store.test.ts`:
  `"skips directory fsync on win32 (GG)"`.
- **0 edits** to the existing POSIX-ordering test (it remains the
  regression gate for darwin / linux).
- Total core test delta: +1.

## §9 References

- DD2 BB hardening spec — the original fsync design.
- FF Windows port deferral spec — the v0.2 status quo this
  supersedes (§1 only).
- Node.js `fs.fsyncSync` docs: "On Windows, this is implemented
  by `FlushFileBuffers`."
- SQLite "How To Corrupt An SQLite Database File" §5.0: NTFS
  metadata journaling makes directory fsync unnecessary.
- LWN "Ensuring data reaches disk" (2009): POSIX dir-fsync
  requirement on ext4 / xfs.
