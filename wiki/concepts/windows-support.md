---
title: Windows support
tags: [concept, windows, ci, portability]
sources:
  - docs/superpowers/specs/2026-06-11-windows-port-design.md
status: active
created: 2026-06-11
updated: 2026-06-11
---

# Windows support

MegaSaver is supported on Windows as of the Windows-port remainder
(PRs #104–#108, 2026-06-11). CI proves it: `ci.yml` runs the `verify`
job on a `[ubuntu-latest, windows-latest]` matrix (`fail-fast: false`).
The deferral spec `2026-05-10-windows-port-deferral.md` is superseded.

## What's supported

- **Store path** — win32 uses `%LOCALAPPDATA%\megasaver` (fallback
  `%USERPROFILE%\AppData\Local`). The env boundary `readStoreEnv`
  reads `HOME → USERPROFILE`. Fails loud (throws) when no base dir is
  resolvable instead of writing a relative path. Same branch in the
  GUI bridge (`resolveBridgeStorePath`) and skill-packs
  (`globalPacksRoot`). POSIX byte-identical. See [[entities/cli]].
- **CRLF line endings** — connector drift detection classifies
  in-sync/noop by EOL-normalized comparison, so a mixed-EOL file
  (CRLF prose + LF block, common on Windows) is not misreported as
  drift (`normalizeEol`, PR #105).
- **ID case** — project/session/memory id schemas require lowercase
  UUIDs, so two ids differing only in case cannot alias one file on a
  case-insensitive filesystem (NTFS/APFS) (PR #106).
- **Atomic writes** — `atomicWriteFile` (core, stats, content-store)
  opens the temp file `r+` for the durability fsync: Windows
  `FlushFileBuffers` rejects a read-only handle. The parent-dir fsync
  is skipped on win32 (NTFS journals rename metadata).
- **Repo line endings** — `.gitattributes` (`* text=auto eol=lf`)
  forces LF in the working tree so the Windows runner's `core.autocrlf`
  does not flip tracked files to CRLF (which biome rejects).

## Test discipline on Windows

- POSIX-only tests (symlink creation needs elevation → EPERM; chmod
  mode bits are ignored on NTFS) are guarded by a per-package
  `describeUnlessWindows` helper. Each skip carries a WHY comment so a
  skipped Windows test is never mistaken for coverage.
- Path assertions are host-independent: tests compute expected values
  with the same `node:path` `resolve`/`isAbsolute` the impl uses,
  rather than POSIX string literals (which resolve to drive-prefixed
  backslash paths on a Windows host).

## Deferred (tracked follow-ups, not blocking)

- True 2-OS-process Windows lock-contention test (the existing
  single-process lock suite passes on the Windows leg).
- `apps/cli` / `apps/gui` `tsconfig.test.json` silently excludes
  `test/` from typecheck — enabling it surfaces ~20 pre-existing
  type errors (follow-up).
- `mega mcp {status,install,uninstall}` read `HOME` without a
  `USERPROFILE` fallback (MCP config paths, not the store) (follow-up).
- `pnpm clean` uses POSIX `rm -rf` (not in the `verify` path).
