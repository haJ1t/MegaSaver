---
title: '@megasaver/cli — v0.1 scaffold app'
date: 2026-05-05
risk: medium
status: approved
related:
  - docs/superpowers/specs/2026-05-04-shared-package-design.md
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - wiki/concepts/agent-agnostic-core.md
  - wiki/syntheses/mega-saver-product.md
  - wiki/entities/core.md
  - wiki/entities/shared.md
---

# `@megasaver/cli` — v0.1 scaffold app

## 1. Context

`@megasaver/shared` and `@megasaver/core` are live on `main`.
`@megasaver/core` exposes `Project`, `Session`, and `MemoryEntry`
schemas plus an in-memory registry. Filesystem persistence is not yet
in scope.

`@megasaver/cli` is the next package in the headless-first v0.1
slice. It is the `mega` command — the developer-facing entry point
that future connector and persistence specs build under.

This first CLI spec is intentionally narrow. The Core registry is
in-memory only, so a CLI that mutates state across invocations cannot
be useful yet. This spec ships the scaffold: the `mega` binary,
Citty wiring, and a stateless `mega doctor` command. Real CRUD
commands, registry consumption, and connector dispatch land in their
own specs once durable storage exists.

## 2. Goal

Ship the smallest useful CLI scaffold:

1. Stand up `apps/cli` with the established workspace, tsup, Vitest,
   and Biome conventions.
2. Wire Citty as the CLI framework with one subcommand: `doctor`.
3. Provide three top-level surfaces: `mega --version`, `mega --help`
   (Citty default), and `mega doctor`.
4. Prove the `mega` bin entry resolves through pnpm so future specs
   can extend it without re-litigating layout decisions.
5. Lock the app authoring pattern for future CLI features:
   pure-function check layer, glue handler, unit tests via direct
   import, no subprocess testing.

Out of scope: see §10.

## 3. Risk

Risk level: **MEDIUM**.

Reason: this app introduces the `mega` command name and the
top-level CLI surface that every future v0.1 user-facing feature
extends. It does not mutate state, expose a public library API,
touch durable storage, or talk to agents — those are MEDIUM risk
upgrades that arrive in their own specs. MEDIUM matches the default
guidance in `docs/conventions/risk-modes.md`.

Required controls:

- Work happens in `feat/cli-package` worktree.
- Full superpowers chain is mandatory.
- TDD is mandatory for every behavior.
- `pnpm verify` is required before completion.
- External `code-reviewer` pass is required before merge.
- Wiki updates are required when the spec, plan, and merge status
  land.

`critic` is not required at MEDIUM. `architect` is not required —
this app consumes the locked Core surface, it does not extend the
engine boundary.

## 4. Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | First CLI slice | Scaffold only: bin entry, Citty wiring, `doctor` subcommand. No state mutation. |
| 2 | Workspace location | `apps/cli` (not `packages/cli`). Matches `CLAUDE.md §2`. |
| 3 | CLI framework | `citty` (UnJS) per `CLAUDE.md §3`. |
| 4 | Bin name | `mega`. Single bin entry. |
| 5 | Library export | None. App package, no public surface, no `exports` field. |
| 6 | Publication | `private: true`. No npm publish in v0.1. |
| 7 | `doctor` checks | Three stateless checks: Node version (≥22 PASS, else FAIL), platform (always PASS, informational), cwd (always PASS, informational). |
| 8 | Output style | Plain text. No ANSI colors. No `--json` flag. |
| 9 | Exit code | `process.exitCode = 0` on all PASS, `process.exitCode = 1` on any FAIL. Handler does not call `process.exit`. |
| 10 | Test strategy | Unit tests only via direct handler import and `console.log` spy. No subprocess tests. No build dependency for `pnpm verify`. |
| 11 | Pure-fn split | `checkNode`, `checkPlatform`, `checkCwd`, `runChecks`, `renderReport`, `exitCodeFor` exported from the doctor module so glue and rendering test independently. |
| 12 | Core consumption | None in this slice. CLI does not import `@megasaver/core` yet. |
| 13 | Connector dispatch | None in this slice. Connector subcommands land in connector specs. |

These decisions require a follow-up spec to change.

## 5. Public surface

The package exposes one entry point: the `mega` bin.

```jsonc
// apps/cli/package.json (excerpt)
{
  "name": "@megasaver/cli",
  "private": true,
  "type": "module",
  "bin": { "mega": "./dist/cli.js" }
}
```

There is no `exports` field. There is no `main` or `types` field.
This package is consumed only by the bin symlink that pnpm installs
at the workspace root (`node_modules/.bin/mega`). Programmatic
import from another workspace package is forbidden in this slice; if
a future package needs the doctor logic, that package extracts a
shared module rather than importing into an app.

## 6. Command surface

### 6a. `mega --version`

Citty resolves `meta.version` from `defineCommand` and prints it.
Source value comes from `apps/cli/package.json` via JSON import.
Initial value: `"0.0.0"`.

Exit code: 0.

### 6b. `mega --help`

Citty default help renderer. Lists the `doctor` subcommand and the
`--version` flag. No custom help formatter in this slice.

Exit code: 0.

### 6c. `mega doctor`

Three checks, fixed order, fixed format.

```text
node v22.11.0 PASS
platform darwin PASS
cwd /Users/me/MegaSaver PASS

3 PASS / 0 FAIL
```

If a check fails, that line includes a parenthesized reason:

```text
node v20.10.0 FAIL (need ≥22)
platform darwin PASS
cwd /Users/me/MegaSaver PASS

2 PASS / 1 FAIL
```

Format rules:

- One line per check. Tokens separated by single spaces.
- `<key> <value> <status>[ (reason)]`.
- Trailing blank line, then the summary `<P> PASS / <F> FAIL`.
- All output on stdout. Stderr is unused in this slice.
- No ANSI codes.

Exit code: `process.exitCode = 1` if any FAIL, otherwise unset (0).

## 7. Module layout

```text
apps/cli/
├─ src/
│  ├─ cli.ts                # bin entry — runMain(mainCommand)
│  ├─ main.ts               # defineCommand({ subCommands: { doctor } })
│  └─ commands/
│     └─ doctor.ts          # checks + render + handler
├─ test/
│  └─ doctor.test.ts        # unit tests for doctor module
├─ package.json
├─ tsconfig.json
├─ tsconfig.test.json
└─ tsup.config.ts
```

The split mirrors `packages/core` and `packages/shared` (focused
files, ESM-only, tsup build, Vitest tests outside `src`). The CLI
adds the `commands/` folder so future subcommands live next to
`doctor` without churning `main.ts`.

## 8. Doctor module surface

The `commands/doctor.ts` module exports the following symbols.

```ts
export type Check = {
  key: string;
  value: string;
  pass: boolean;
  reason?: string;
};

export function checkNode(version?: string): Check;
export function checkPlatform(platform?: NodeJS.Platform): Check;
export function checkCwd(cwd?: string): Check;

export function runChecks(): Check[];
export function renderReport(checks: Check[]): string;
export function exitCodeFor(checks: Check[]): 0 | 1;

export const doctorCommand: CommandDef;
```

Behavior:

- `checkNode` accepts a Node version string. When omitted, it reads
  `process.versions.node`. PASS when the major version parses to a
  number `>= 22`. FAIL with `reason: "need ≥22"` otherwise.
- `checkPlatform` accepts a platform string. When omitted, it reads
  `process.platform`. Always PASS. The value column carries the
  platform string verbatim.
- `checkCwd` accepts a cwd string. When omitted, it reads
  `process.cwd()`. Always PASS. The value column carries the path
  verbatim.
- `runChecks` calls the three checks in fixed order
  (`node`, `platform`, `cwd`) and returns the resulting `Check[]`.
- `renderReport` formats the array into the stdout block described
  in §6c, including the summary line.
- `exitCodeFor` returns `1` when any check has `pass: false`,
  otherwise `0`.
- `doctorCommand.run` calls `runChecks`, prints
  `renderReport(...)` via `console.log`, and sets
  `process.exitCode = exitCodeFor(...)`. The handler does not call
  `process.exit`.

The handler is glue. All branching logic lives in the pure
functions so tests do not have to mock `process` globals.

## 9. Dependencies

Runtime dependencies:

- `citty` (UnJS, ESM-native CLI framework).

This package does not import `@megasaver/core` or
`@megasaver/shared` in this slice. Doing so would require either
fabricating a use of those packages (which violates `CLAUDE.md §13`
"no half-implementations") or wiring real CRUD without a persistence
spec.

Dev dependencies inherited from the workspace root:

- `vitest`
- `tsup`
- `typescript`
- `@biomejs/biome`

Forbidden dependencies in this spec:

- Color libraries (`picocolors`, `chalk`, `kleur`).
- Prompt libraries (`prompts`, `inquirer`, `@inquirer/*`).
- Filesystem helpers beyond Node built-ins.
- `execa` or other subprocess libraries.
- LLM SDKs.

## 10. Out of scope

- Any CRUD command (`mega project add`, `mega session start`, etc.).
- Importing `@megasaver/core` or `@megasaver/shared`.
- Persistence and storage backends (filesystem, SQLite, JSON).
- `--json` flag, machine-readable output, structured logging.
- ANSI colors, spinners, progress bars, prompts.
- Connector subcommands (`mega claude`, `mega cli`).
- Subprocess integration tests, end-to-end smoke tests.
- npm publication, version bumps beyond `0.0.0`.
- Custom help renderer.
- Plugin / extension hooks.
- Telemetry or analytics.

## 11. Test strategy

The implementation plan must use strict TDD with this layered split:

1. Scaffold app and smoke-test the build pipeline (without behavior
   tests).
2. Write `checkNode` tests, then implement `checkNode`.
3. Write `checkPlatform` and `checkCwd` tests, then implement.
4. Write `renderReport` and `exitCodeFor` tests, then implement.
5. Write the handler smoke test (`vi.spyOn(console, "log")`,
   `process.exitCode` reset in `afterEach`), then implement
   `doctorCommand.run`.
6. Wire `main.ts` and `cli.ts` last; these are framework glue and do
   not require behavior tests.
7. Run `pnpm --filter @megasaver/cli test` after every task.
8. Run `pnpm verify` before completion.

Expected coverage:

- `checkNode` PASS for `"22.x"` and `"23.x"`.
- `checkNode` FAIL with `reason: "need ≥22"` for `"20.x"` and
  earlier.
- `checkNode` PASS for the lower boundary `"22.0.0"` and a
  pre-release like `"22.0.0-rc.1"`.
- `checkPlatform` returns the platform string and PASS.
- `checkCwd` returns the cwd string and PASS.
- `renderReport` matches the §6c format for an all-PASS hash.
- `renderReport` includes the parenthesized reason for a FAIL row.
- `renderReport` summary line counts PASS and FAIL correctly.
- `exitCodeFor` returns `0` for all-PASS and `1` for any-FAIL.
- `doctorCommand.run` calls `console.log` exactly once with the full
  `renderReport(...)` block.
- `doctorCommand.run` leaves `process.exitCode` unset on all-PASS
  and sets it to `1` when a FAIL is injected via dependency
  override.

Property-based tests are not used. The input domain is small and
discrete; `fast-check` is overkill here.

## 12. Build & smoke evidence

The merge gate requires:

1. `pnpm --filter @megasaver/cli lint` — Biome clean.
2. `pnpm --filter @megasaver/cli typecheck` — `tsc -b --noEmit`
   clean.
3. `pnpm --filter @megasaver/cli test` — all unit tests PASS.
4. `pnpm --filter @megasaver/cli build` — `dist/cli.js` exists, the
   first line is `#!/usr/bin/env node`, sourcemap is emitted,
   `dist/cli.d.ts` is not emitted (`dts: false`).
5. `pnpm verify` — root lint + typecheck + test green.
6. Manual bin smoke (recorded in PR description, not committed):
   - `pnpm install` — root `node_modules/.bin/mega` symlink exists.
   - `pnpm exec mega --version` — prints `0.0.0`, exit 0.
   - `pnpm exec mega --help` — prints the Citty default help, exit
     0.
   - `pnpm exec mega doctor` — prints the §6c block on Node 22,
     exit 0.

A changeset is not added: the package has no public API surface,
`private: true` is the only published-package signal, and
`CLAUDE.md §9.9` only requires a changeset when the public API
changes.

## 13. Wiki updates

When this spec lands:

- Add `wiki/entities/cli.md` with frontmatter and the `Scope`,
  `Authoring style`, `Boundary rules`, and `Related` sections used by
  the `shared` and `core` entity pages.
- Add the CLI entity link to `wiki/index.md` under Entities.
- Append a `wiki/log.md` entry for the CLI package spec.

When the implementation plan lands, append another log entry. When
the PR merges, update the CLI entity status and append merge
evidence to `wiki/log.md`.

## 14. Open assumptions

These are documented for the implementation plan to verify in early
tasks. Each is a likely-true assumption based on `shared` and `core`
package experience; if any fails, the plan amends accordingly.

- Root `pnpm-workspace.yaml` already lists `apps/*`, so creating
  `apps/cli/` registers the package without further configuration.
- Root `tsconfig.base.json` sets `incremental: true` and
  `composite: true`; the CLI `tsconfig.json` overrides both to
  `false` to keep tsup DTS workers happy (the `shared` and `core`
  packages already do this).
- Root `biome.json` covers `apps/**` via its existing globs and
  ignores `dist/`. The plan verifies this in its scaffold task; if
  not, the CLI adds a local override or the spec is amended.
- `import pkg from "../package.json" with { type: "json" }` works
  through tsup with `resolveJsonModule: true`. The plan verifies via
  the first build smoke; if tsup rejects the assertion syntax, the
  plan switches to `createRequire`-based JSON read.
- Citty `defineCommand({ run() })` allows the handler to set
  `process.exitCode` and rely on natural process termination to
  propagate the code. The handler smoke test confirms the value is
  set without invoking `process.exit`.
