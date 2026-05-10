---
title: BB hardening — fsync durability + cross-process lock + S10 concurrency stanza
risk: HIGH
status: draft
created: 2026-05-10
updated: 2026-05-10
related:
  - packages/core/src/json-directory-store.ts
  - packages/core/test/json-directory-store.test.ts
  - apps/cli/test/session/update-concurrency.test.ts
  - docs/superpowers/specs/2026-05-09-mega-connector-status-design.md
---

# DD2 — BB hardening (durability + cross-process lock + S10 stanza)

## §0 TL;DR

Three independent hardening items closing the BB backlog from
`wiki/index.md` Status §:

1. **fsync durability** — `atomicWriteFile` adds POSIX-correct
   fsync calls so a crash between temp-write and rename leaves a
   recoverable on-disk state.
2. **Cross-process lock test** — new integration test forks two
   built CLI processes that contend for the same store and
   asserts serialization (no corruption, no leaked lockfile).
3. **S10 concurrency stanza** — new §11 in
   `2026-05-09-mega-connector-status-design.md` documents
   status-vs-sync race policy with a worked example.

Risk HIGH: durability semantics + multi-process coordination. Full
superpowers chain (architect optional, critic mandatory).

## §1 Item 1 — fsync durability

### Today's behaviour

`atomicWriteFile` in `packages/core/src/json-directory-store.ts`:

```ts
mkdirSync(parentDir, { recursive: true });
writeFileSync(tempPath, content);
renameSync(tempPath, filePath);
```

POSIX guarantees `rename` is atomic for paths in the same
directory, so a reader never sees a half-written final file.
However:

- `writeFileSync` returns once the kernel has the bytes in its
  page cache. Without `fsync`, a crash before the page cache
  flushes can lose the temp file's data even though the rename
  appears to have happened.
- The directory entry created by the rename is itself a metadata
  change. Without `fsync` on the parent directory fd, a crash can
  lose the rename even if the temp file's data flushed.

Both gaps are real on Linux ext4/xfs and on macOS APFS.

### Decision: fsync the temp file BEFORE rename, fsync the parent
### dir AFTER rename

POSIX best practice is unambiguous (Linux man page `fsync(2)`,
LWN "Ensuring data reaches disk" 2009, sqlite docs §6.7):

1. Open temp file fd → `writeFileSync` (or write through fd) →
   `fsync(tempFd)` → `closeSync(tempFd)`. After this, the temp
   file's data is durable on disk.
2. `renameSync(tempPath, filePath)`. The rename itself is an
   atomic metadata operation; once it returns, the parent
   directory's in-memory state shows the new entry.
3. Open parent dir fd → `fsync(dirFd)` → `closeSync(dirFd)`.
   This flushes the directory metadata so the rename survives a
   crash.

Rejected alternative — fsync the temp AFTER rename: at the
moment of rename, the temp's data may still live in the page
cache. A crash flushes the directory entry (rename is durable)
but loses the data, leaving an empty / truncated final file.
This is the classic "ext4 zero-length file after crash" bug.

### Platform notes

- **Linux** — `fsync(dirFd)` is well-defined and required.
- **macOS** — `fsync` does not flush the disk write cache;
  `F_FULLFSYNC` does. We use plain `fsync` (matches sqlite
  default and Node.js `fs.fsyncSync`); a hard power-loss on
  macOS may still lose data, but a kernel panic / process kill
  is fully covered. `F_FULLFSYNC` is intentionally out of
  scope: it's ~10× slower and the Mega Saver risk model is
  process-crash, not bare-metal power-loss.
- **Windows** — `fsync` on a directory fd may throw `EISDIR`
  on some filesystems. We swallow `EISDIR`/`EPERM` on the
  *directory* fsync only (data is already durable from the
  temp fsync; the directory fsync is belt-and-suspenders).
  The test suite does not gate on Windows behaviour (CI is
  Linux/macOS only). If a Windows user hits this, the data
  is still recoverable; only the rename's durability against
  bare-metal crash is reduced.

### Latency

`fsync` cost is ~1-10 ms on SSD, ~10-50 ms on spinning disk. We
add two fsync calls per write. For Mega Saver's write rate
(human-driven CLI, < 1 write/sec), the latency is invisible.
For batch writes (e.g. import scripts later), we'd revisit.

### Test plan (V2 partial-write)

The existing V2 test
(`packages/core/test/json-directory-store.test.ts`) already
covers the rename-fails-after-write case via `vi.mock`. We add a
sibling assertion: verify `writeFileSync` is called with a temp
path containing `.tmp`, and that the new fsync calls fire. We
do NOT mock `fsync` itself (that's testing the test); we trust
Node's `fs.fsyncSync` to work and assert the call sites exist.

A second test verifies the durability claim end-to-end via a
spawned subprocess: child writes then is `SIGKILL`'d after
fsync but before rename. Parent re-reads the file and expects
the original content (rename never landed, but no data loss).

## §2 Item 2 — Cross-process lock test

### Today's behaviour

`withDirLock` in `json-directory-registry.ts` creates
`.projects.lock` via `openSync(path, "wx")`. Cross-process
correctness is asserted in spec, not in tests.

### Test design

`packages/core/test/json-directory-store.cross-process.test.ts`
(new file). Build the CLI first (`pnpm build`); reference
`apps/cli/dist/cli.js`.

The existing V1 test
(`apps/cli/test/session/update-concurrency.test.ts`) already
uses `child_process.spawn` against the built CLI for two
concurrent `session update` calls. Reuse that pattern — but
move the test into `packages/core/test/` so it can use the
core's vitest project (and the BB backlog item lives in core,
not CLI).

Test shape:

1. `beforeAll`: build CLI via `pnpm --filter @megasaver/cli
   build` (skip if dist/cli.js is fresh).
2. Seed a temp store with one project + one session.
3. Spawn 5 concurrent `mega session update <id> --title
   T<n> --store <root>` processes.
4. Wait for all to exit. Assert:
   - all exit code 0 (lock serialises, never rejects)
   - `sessions.json` is valid JSON with exactly 1 record
   - `title` equals one of `T0..T4` (no merge / partial)
   - no `.projects.lock` left in the directory
   - no `.tmp` files left

### Flake risk

The test waits for 5 child processes; total time ~2-5 s. Lock
acquire timeout is 5 s, so if all 5 contend for the same lock
serially we are at the limit. Mitigation: assert exit code
inside the loop and pin the title to one of the 5 inputs (which
proves serialisation) rather than asserting *which* one wins.

CI flake budget: 5 consecutive runs locally (per CRITICAL §
in task brief) before claiming GREEN.

## §3 Item 3 — S10 concurrency stanza

### Add §11 to `2026-05-09-mega-connector-status-design.md`

Header: `## §11 Concurrency: status vs concurrent sync`.

Content:

- Status reads target files; sync writes target files.
- No coordination — status may report `drift` while sync is
  mid-write (sync writes through `atomicWriteFile`'s temp +
  rename, so reads always see whole files; the race is
  *between* the read and a subsequent write).
- Worked example:
  - T0: `mega connector status` reads `CLAUDE.md`, sees old
    block — status prints `in-sync` (matches old context).
  - T1: `mega connector sync` writes new block — atomic.
  - T2: another `status` invocation reads the new file → `drift`
    relative to its own newly-built context if a session
    changed in between.
- Policy: status is best-effort. For an authoritative read, run
  `mega connector sync` then `status` in series.

This is documentation only (zero code change); it closes the S10
backlog item.

## §4 Risk

HIGH per `wiki/index.md` Status § and CLAUDE.md §12. Touches
Core durability semantics. Critic review mandatory pre-merge;
architect consultation optional (decision is well-grounded in
POSIX literature).

## §5 Out of scope

- `F_FULLFSYNC` for bare-metal power-loss (macOS).
- Directory-level lock granularity beyond `.projects.lock`
  (no per-file locks).
- Lock holder retry policy beyond existing 5 s timeout.
- Status's read-side serialisation against concurrent writes
  (read-only; uses `readFileSync` which sees whole rename'd
  files atomically).

## §6 Tests delta

- V2 test: extend existing test in
  `packages/core/test/json-directory-store.test.ts` with a
  third assertion checking fsync calls via spy.
- New file `packages/core/test/json-directory-store.cross-process.test.ts`:
  one cross-process test (~2-5 s).
- Existing V1 test in `apps/cli/test/session/update-concurrency.test.ts`
  remains; the new cross-process test is core-level, not CLI.
- Total test delta: +2 (one V2 sibling, one new cross-process).
