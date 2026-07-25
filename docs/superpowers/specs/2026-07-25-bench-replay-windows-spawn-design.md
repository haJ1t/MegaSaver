---
risk: MEDIUM
status: implemented
source: windows-latest `verify` red on every PR since bench-replay landed
---

# bench-replay windows spawn — design

## Problem

`verify (windows-latest)` fails on every PR and on `main`:

```
Error: prepareSaverStore: could not enable the saver in C:\...\bench-replay-task_1-eUuAXq:
  spawnSync C:\...\bench-replay-pipeline-QSLIHB\mega.cjs EFTYPE
```

`packages/bench-replay/src/saver-subprocess.ts` hands `--mega-bin` straight to
`execFileSync`, which asks the OS loader to start the file. That only works
where a shebang plus an exec bit work. `--mega-bin` is routinely a JS
entrypoint — the pipeline fixture writes a `mega.cjs`, and the store-isolation
test points at `apps/cli/dist/cli.js` — so on win32 the loader refuses with
`EFTYPE` and takes down five tests and the whole job.

The check has been red long enough that PRs are being merged past it, which
means Windows has effectively no CI at all.

## Decision

Route script bins through the current node instead of the OS loader:

```ts
function spawnParts(megaBin, args) {
  return /\.[cm]?js$/.test(megaBin) ? [process.execPath, [megaBin, ...args]] : [megaBin, [...args]];
}
```

Both spawn sites in the file (`defaultRun`, `prepareSaverStore`) go through it.
`process.execPath` is the node already running the harness, so the child is
guaranteed the same runtime — no PATH lookup, and no `shell: true`, so the path
is never re-parsed by a command interpreter.

A non-script `--mega-bin` is passed through untouched. That is deliberately
narrow: the fix covers **JS entrypoints**, which is what CI passes and what the
red job needs. It does NOT cover a Windows operator running the harness against
an installed CLI, where `--mega-bin` defaults to `"mega"` and resolves to
`mega.cmd` — node has refused to `execFile` a `.cmd`/`.bat` without
`shell: true` since the CVE-2024-27980 patch, so that path fails with `EINVAL`
instead. An extensionless `node_modules/.bin/mega` shebang script is likewise
still unstartable on win32. Both are real, neither is on the CI path, and both
want a different fix (a shell-safe launcher) than this one.

## Test strategy

Windows-only failures cannot be reproduced on the dev machine, so the guard
recreates the *condition* rather than the platform: the fixture writes a
`mega.cjs` with **no shebang and no exec bit**. POSIX then refuses it with
`EACCES` exactly as win32 refuses `EFTYPE` — the test fails before the fix on
every platform and passes after.

The sibling `saver-subprocess-store-isolation.test.ts` skipped itself on win32
for this same reason. The skip is removed. Un-skipping alone would have made it
pass vacuously there: its `realStoreRoot()` mirrored only resolveStorePath's
POSIX branch, so on Windows it named a directory that never exists and the
"real store was not written" assertion would hold for free. The win32
`LOCALAPPDATA` branch is now mirrored too.

## Out of scope

`scripts/bench-replay.mjs:249` calls `execFileSync("npm", …)`, which on Windows
resolves to `npm.cmd` and fails the same class of error. It sits on the
`record` path, as does `runAgent(command.bin, …)` with `--claude-bin`
defaulting to `claude` (`claude.cmd` on Windows). CI never runs `record` — it
spends real money — so neither is what turned the job red. This fix is scoped
to `replay`. Flagged, not fixed.
