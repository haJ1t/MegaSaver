---
title: Windows support
tags: [concept, windows, ci, portability]
sources:
  - docs/superpowers/specs/2026-06-11-windows-port-design.md
status: active
created: 2026-06-11
updated: 2026-08-24
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
- **Relative-path identifiers are POSIX** — a project-relative path used as
  an *identifier* across an API boundary (never for fs access) is normalized
  at the emitter (`split(sep).join("/")`) so it cannot depend on the host:
  `indexer/scan.ts`, `mcp-bridge/get-edit-impact.ts`, `cli/read-wiki.ts`,
  `gui/memory-graph.ts`, `core/planner/service.ts` (#332). Absolute store/fs
  paths stay native (see "Store path").

## Test discipline on Windows

- POSIX-only tests (symlink creation needs elevation → EPERM; chmod
  mode bits are ignored on NTFS) are guarded by a per-package
  `describeUnlessWindows` helper. Each skip carries a WHY comment so a
  skipped Windows test is never mistaken for coverage.
- Path assertions are host-independent: where the impl emits a **native**
  path, tests compute the expected value with the same `node:path`
  `resolve`/`isAbsolute` the impl uses, not a POSIX string literal (which
  becomes a drive-prefixed backslash path on Windows). Where the impl emits
  a POSIX **identifier** (bullet above), the literal is right and a received
  backslash is the defect — how `planner-service.test.ts:39` caught
  `service.ts` (#332). Decide which kind the value is before picking a side.

## Vitest worker starvation on the Windows runner

Under the repo-wide Turbo test graph the Windows runner starves the Vite
transform and collection times out before any test runs:
`[vitest-worker]: Timeout calling "fetch" with [..., "ssr"]`. It is a
property of the runner, not of any package — seen in `retrieval`
(PR #321), then `long-memory`, then `core`. Capping one package moves
the pressure to the next one scheduled.

The cap belongs in `ci.yml` on the Windows leg
(`--maxWorkers=2 --minWorkers=1`), not in a package's `vitest.config.ts`.
`retrieval`'s earlier `singleFork: true` remains in place, so two
mechanisms coexist today.

Three traps, all already hit once:

- **A multi-line `run:` block needs `shell: bash`.** The Windows default is
  pwsh, where only the LAST command's exit code propagates — `Bundle smoke`
  concluded `success` around a failing vitest (run 31279915849). Single-line
  `&&` chains are safe (pwsh short-circuits); multi-line blocks are not.
- **`VITEST_MAX_THREADS` is silently ignored** by Vitest 2.1.9 — measured
  275 s before and after. The CLI flags work (275 s → 40 s at
  `--maxWorkers=1`); Turbo forwards them through `--`. `--maxWorkers`
  alone throws `minThreads and maxThreads must not conflict`.
- **`pool: "forks"`** cures the starvation but breaks
  `lm2-vector-store-quota`: Windows `statSync().ino` is not stable
  across processes.

## Seeded ledger identities must be bigint-exact

Production computes lock identities with `statSync(..., {bigint:true})`
→ `losslessFileIdentity` (`lm2-lock.ts`), producing exact decimal
strings. Windows NTFS file IDs are `(seq<<48)|record`; once a file
lands on an MFT record whose sequence ≥ 32, its inode exceeds 2^53
and a NUMBER `statSync()` rounds it — so a fixture ledger seeded from
non-bigint stats encodes a *different* identity than the runtime
computes, and `prepareLm2LedgerOperation` fail-closed rejects it
(`{status:"invalid"}`), exactly as designed.

Signature: `expected 'invalid' to be 'ready'`, one random
seeded-ledger test per run, siblings passing in the same run (each
test creates its own lock file; magnitude varies per MFT record),
ubuntu never affected. Seen 2026-08-24 runs 31976661584 +
32771189395 (`lm2-index-operation.test.ts`,
`lm2-vector-store-quota.test.ts`). The codebase already knew the
hazard: the legacy-ledger migration test guards on
`Number.isSafeInteger`, and `pool:"forks"` above cites unstable
Windows ino.

Fix: fixtures must seed `lockIdentity` via
`statSync(lockPath, {bigint:true}).dev.toString()/.ino.toString()` —
byte-identical to production's derivation, correct on every platform.
Do NOT retry `beginIndexOperation` on invalid instead: the mismatch is
deterministic per lock file, so retries only burn time.

## Deferred (tracked follow-ups, not blocking)

- **Three `lm2-catalog-security` lock-identity tests are POSIX-only** and
  need a Windows machine to settle. The V2 lock identity is `dev+ino+mode`,
  none of which carries (unstable `ino`, NTFS ignores mode bits). Marked
  `it.skipIf(win32)` rather than guessed at: the failures point both ways —
  one is `expected false to be true` (Windows stricter) while this page's
  precedent has Windows more permissive, so no single rule follows.
- **Deadline-gated side effects are not assertable on the Windows leg.**
  Anything sharing the 500 ms `TASK_KICKOFF_DEADLINE_MS` budget is advisory
  there; assert it only under an opt-in "this host is fast" env var, never on
  `platform === "win32"` (`bundle-smoke.test.ts:1259`, #332).
- True 2-OS-process Windows lock-contention test (the existing
  single-process lock suite passes on the Windows leg).
- `apps/cli` / `apps/gui` `tsconfig.test.json` silently excludes
  `test/` from typecheck — enabling it surfaces ~20 pre-existing
  type errors (follow-up).
- `mega mcp {status,install,uninstall}` read `HOME` without a
  `USERPROFILE` fallback (MCP config paths, not the store) (follow-up).
- `pnpm clean` uses POSIX `rm -rf` (not in the `verify` path).
