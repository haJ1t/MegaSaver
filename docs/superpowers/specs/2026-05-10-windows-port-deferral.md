---
title: FF — Windows port deferred to v0.3 (deferral spec)
risk: LOW
status: decision
created: 2026-05-10
updated: 2026-05-10
related:
  - packages/core/src/json-directory-store.ts
  - docs/superpowers/specs/2026-05-10-dd2-bb-hardening-design.md
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
---

# FF — Windows port deferred to v0.3 (deferral spec)

## §0 TL;DR

Full Windows filesystem port is deferred to v0.3 milestone.
v0.2 ships with **graceful Windows degradation**: dir fsync swallows
`EISDIR`/`EPERM`/`ENOTSUP` and continues (data durability not
compromised; rename durability reduces to process-crash only).

This spec documents what works today, what's unsupported, and
the v0.3 scope.

## §1 Current state (v0.2)

### Node.js and platform support

- **Node 22 LTS** is required (`package.json` engine: `>=22`).
- Node 22 runs on Windows 10/11 with full core module support.
- All Mega Saver code is platform-agnostic: no `process.platform`
  checks, no platform-specific imports, no native bindings.

### fsync durability (graceful degradation)

Per DD2 BB hardening spec §1, `atomicWriteFile` in
`packages/core/src/json-directory-store.ts` calls:

1. Temp file write → `fsync(tempFd)` (data durability).
2. `renameSync(tempPath, filePath)` (atomic rename).
3. Parent dir open → `fsync(dirFd)` (rename durability).

**Windows behaviour**: step 3's dir fsync may throw `EISDIR`
(not a valid file descriptor), `EPERM` (permission denied on
some filesystems), or `ENOTSUP` (operation not supported).

**v0.2 degradation**: catch and swallow these three error codes
on the dir fsync only. The temp file's data is already durable
from step 1; skipping step 3 reduces only the rename's
durability against bare-metal power-loss. For process crash,
data is fully recoverable (rename landed, temp file is gone,
final file content is intact).

**Impact**: low for Mega Saver's threat model (process crash, not
bare-metal power-loss). Windows users are fully functional in v0.2.

### Path resolution

XDG Base Directory paths are resolved via `os.homedir()` and
string manipulation (no platform-specific fallbacks). The spec
written during CLI project CRUD (2026-05-06) explicitly marks
Windows path resolution (`%APPDATA%\megasaver` style) as out of
scope for v0.1. Today, Mega Saver builds on Node 22 on Windows
and resolves paths through Node's cross-platform `path` module;
tests are Linux/macOS only (CI gate).

**Current state**: untested on Windows. Path resolution
*mechanically* works (Node `path.resolve()` is cross-platform);
semantics (e.g., environment variable overrides,
`%APPDATA%` fallback) are unvalidated.

## §2 Known gaps (v0.3 scope)

### Case-insensitive filesystems

macOS (APFS case-insensitive by default) and Windows (NTFS
case-insensitive) silently coerce paths. Mega Saver stores
project IDs and session IDs in filenames. A case-sensitivity
bug is invisible in test but surfaces in user data loss:
`projects/ABC123` and `projects/abc123` may resolve to the same
file on Windows, causing a merge.

**v0.3 action**: audit all path construction in `@megasaver/core`
and CLI; implement case-insensitive resolution and validation;
add test matrix for Windows.

### Line endings (CRLF vs LF)

The agent connector outputs (especially `@megasaver/connector-claude-code`'s
`CLAUDE.md` write and `@megasaver/connector-generic-cli`'s
`AGENTS.md` write) may normalize or not normalize line endings.
On Windows, `\n` (LF) written by Node is often swallowed or
read as `\r\n` (CRLF) by text editors, causing drift detection
failures when the connector re-reads.

**Current state**: CRLF not normalized in connector outputs.

**v0.3 action**: audit connector write paths and normalize to LF
everywhere (enforced at runtime or via `.gitattributes` +
pre-commit hook).

### Lock file semantics

Windows file locking differs from POSIX: a `lockfile` package
or custom lock may exhibit different timeout/release behaviour
on Windows. Mega Saver uses `openSync(path, "wx")` (exclusive
create), which is atomic on all platforms but has untested
timeout and release semantics on Windows under contention.

**Current state**: locked in POSIX (Linux/macOS).

**v0.3 action**: test cross-process lock with high contention on
Windows (5+ concurrent writers), document timeout policy,
consider a platform-specific lock helper if needed.

### Full filesystem semantics audit

v0.3 scope: complete audit of all `fs.*Sync` calls for
platform-specific quirks (temp file cleanup, permission
preservation, symlink handling, case sensitivity, encoding
defaults).

## §3 v0.2 recommendation

**Ship as-is with graceful degradation.**

- Durability: data is safe; rename durability is reduced
  but acceptable for the process-crash threat model.
- Testability: fsync errors are caught and logged (no silent
  failures); users can report Windows-specific issues.
- Path resolution: mechanically correct; untested on Windows
  but not blocking.
- Line endings: CRLF not normalized but connectors will flag
  drift; user can manually normalize as needed for v0.2.

This posture unblocks v0.2 ship and gives the team v0.3 to
build Windows-specific tests and validation.

## §4 v0.3 milestone scope

v0.3 is the full Windows port. Work items:

1. **Case-insensitive resolution audit** — all project/session
   ID filename construction; add Windows test matrix in CI.
2. **CRLF normalization** — connector output enforcement; add
   Windows CI gate.
3. **Lock file semantics** — contention test on Windows;
   document or fix timeout policy.
4. **Full filesystem semantics audit** — coverage of all
   `fs.*Sync` calls; document platform quirks.
5. **Windows CI gate** — add GitHub Actions Windows runner;
   gate full test suite on all platforms.

Estimated effort: HIGH. Deferred to v0.3 because v0.2 ships
working and the gaps are filesystem-specific, not core-engine
specific.

## §5 References

- **DD2 BB hardening** — `2026-05-10-dd2-bb-hardening-design.md`
  §1 (fsync durability, Windows degradation).
- **CLI project CRUD** — `2026-05-06-cli-project-crud-design.md`
  (Windows path resolution marked out of scope).
- **Core store** — `packages/core/src/json-directory-store.ts`
  (atomicWriteFile implementation).
