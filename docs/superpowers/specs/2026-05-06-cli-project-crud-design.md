---
title: '@megasaver/cli — v0.1 first project CRUD (`mega project create` and `mega project list`)'
date: 2026-05-06
risk: high
status: approved
related:
  - docs/superpowers/specs/2026-05-05-cli-package-design.md
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/specs/2026-05-05-core-persistence-design.md
  - wiki/concepts/agent-agnostic-core.md
  - wiki/concepts/risk-aware-development.md
  - wiki/entities/cli.md
  - wiki/entities/core.md
---

# `@megasaver/cli` — v0.1 first project CRUD

## 1. Context

`@megasaver/shared`, `@megasaver/core`, and `@megasaver/cli` are
live on `origin/main`. Core exposes neutral `Project`, `Session`,
and `MemoryEntry` schemas, an in-memory registry, and a JSON
directory-backed registry (`createJsonDirectoryCoreRegistry`). CLI
ships `mega doctor` only — a stateless three-check command that
does not touch any registry.

This spec adds the first CLI surface that mutates and reads
durable state. It is the smallest dogfood-able end-to-end slice
that exercises the full v0.1 stack (`shared` types → `core`
persistence → `cli` user-facing surface).

It does not add `Session` or `MemoryEntry` commands, connector
behavior, search, context packing, compression, JSON output,
Windows path resolution, environment-variable store overrides, or
a standalone `mega init` command. Those features build on this
slice in their own specs.

## 2. Goal

Ship the smallest useful `Project` CRUD slice for v0.1 dogfood:

1. Add `mega project create <name>` that persists a new `Project`
   to a JSON directory store and prints its UUID.
2. Add `mega project list` that prints every persisted `Project`
   in insertion order.
3. Resolve a default store directory under XDG so the user does
   not have to pass a flag on every invocation.
4. Initialize the store directory on first use, with an explicit
   one-line stderr notice (no silent file creation).
5. Keep Core agent-agnostic: store-layout knowledge stays in
   `@megasaver/core`; CLI is a thin adapter.
6. Map every typed Core error to exit code `1` and a plain stderr
   message that names the failure.

Out of scope: see §11.

## 3. Risk

Risk level: **HIGH**.

Reason: this slice introduces the first user-facing CRUD surface
for Mega Saver. It writes user files at scale under
`$XDG_DATA_HOME/megasaver` and locks pattern decisions that every
later CLI command will inherit (XDG default path, command shape,
output format, error → exit mapping, stderr-notice convention).

Required controls:

- Work happens in the `feat/cli-project-crud` worktree.
- Full superpowers chain is mandatory.
- TDD is mandatory for every behavior, both pure helpers and
  filesystem-touching commands.
- `pnpm verify` is required before completion.
- Feature smoke evidence is required against a temporary store
  directory (no writes under the real XDG path during testing).
- External `code-reviewer` and `critic` passes are both required
  before merge.

## 4. Surface

### 4.1 Commands

```
mega project create <name>
mega project list
```

`<name>` is a single positional argument. It is required. The
underlying `Project` schema requires a non-empty trimmed string.

### 4.2 `--store` flag

```
mega project create [--store <dir>] <name>
mega project list   [--store <dir>]
```

`--store <dir>` is declared on each store-touching subcommand
(`project create`, `project list`). It overrides the default
store directory for the duration of that invocation. The flag
accepts an absolute path or a path relative to the process
working directory.

`mega doctor` does not accept `--store` because it does not
resolve a store; passing it is a usage error. Citty's
automatic `--help` is the only other supported top-level
surface.

### 4.3 Default store directory

Resolution order:

1. `--store <dir>` flag, if present.
2. `$XDG_DATA_HOME/megasaver`, if `XDG_DATA_HOME` is set and
   non-empty.
3. `$HOME/.local/share/megasaver`, otherwise.

This applies on macOS and Linux. Windows path resolution is out
of scope (§11). The same resolver is used by `create` and `list`.

### 4.4 Auto-init behavior

If the resolved store directory does not exist, or exists but
lacks `projects.json` or `sessions.json`, the CLI initializes it
through `@megasaver/core`'s public `initStore(rootDir)` helper
(§5) before any registry operation runs.

On the first initialization (and only the first), the CLI writes
exactly one line to stderr:

```
note: initialized store at <absolute-resolved-path>
```

Subsequent invocations against an already-initialized store write
nothing extra to stderr. The notice is informational only and
does not change exit code.

### 4.5 Output format

Both `create` and `list` print plain text to stdout. No header
row, no JSON, no color, no ANSI. One project per line:

```
<id>  <name>
```

The separator is exactly two ASCII spaces. `<id>` is the canonical
hyphenated UUID returned by `@megasaver/shared`'s `ProjectId`.
`<name>` is the stored name (already trimmed by the `Project`
schema), written verbatim with no quoting and no escaping.

`create` prints exactly one line — the newly created project. The
optional auto-init notice on stderr is independent of stdout.

`list` prints zero lines for an empty store (clean exit), and one
line per persisted project otherwise, in `projects.json` array
order.

Project names containing C0/C1 control characters or DEL are
rejected at create time (see §4.7); the wire-format depends on
names being newline-free.

### 4.6 Duplicate-name policy

`create` rejects a name that exactly matches an existing
project's `name` field (case-sensitive, post-trim comparison
matching the schema's normalization (control characters are
already rejected by the §4.7 row above, so duplicate-name
comparison only ever sees control-char-free trimmed names)). The
check is performed in
the CLI handler by calling `listProjects()` before
`createProject()`. Core does not enforce a unique-name constraint
because uniqueness is a CLI/store-policy decision, not a Core
invariant (an agent-agnostic Core must not assume display-layer
rules).

The error path is described in §4.7.

### 4.7 Errors and exit codes

| Condition                                    | Stderr message                                            | Exit |
|----------------------------------------------|-----------------------------------------------------------|------|
| Empty or whitespace-only `<name>` (Zod fail)         | `error: name must be non-empty`                           | 1    |
| Name contains a C0/C1 control character or DEL  | `error: name must not contain control characters`         | 1    |
| Duplicate name (post-trim)                           | `error: project "<trimmed-name>" already exists`          | 1    |
| Persistence I/O failure                              | `error: store I/O failed: <reason>`                       | 1    |
| Corrupt store JSON or JSONL                          | `error: store at <path> is corrupt: <reason>`             | 1    |
| Empty or whitespace-only `--store <dir>` argument    | `error: --store path must be non-empty`                   | 1    |

All success paths exit `0`. The CLI never throws an unhandled
exception to the user; every typed Core error is mapped through a
single helper (§5.4).

## 5. Architecture

### 5.1 Module layout (`apps/cli/src/`)

```
src/
├─ cli.ts                     # Citty entry (unchanged)
├─ main.ts                    # registers `doctor` and `project` (modify: add `project`)
├─ commands/
│  ├─ doctor.ts               # unchanged
│  └─ project.ts              # NEW: `project` parent + `create` + `list` + format + duplicate-check
├─ store.ts                   # NEW: resolveStorePath (pure) + ensureStoreReady (I/O)
└─ errors.ts                  # NEW: mapCoreErrorToCliError (pure)
```

Layout follows the existing `commands/doctor.ts` precedent
(one file per top-level command, helpers inline). `store.ts` and
`errors.ts` are extracted as their own files because they are
reused by every future store-touching command and benefit from
isolated unit tests. Per `docs/conventions/code-conventions.md`,
files split before reaching 300 LOC.

Test layout mirrors the doctor pattern (flat under `apps/cli/test/`):

```
test/
├─ doctor.test.ts             # unchanged
├─ project.test.ts            # unit tests for format + handlers + integration
├─ store.test.ts              # resolveStorePath + ensureStoreReady
└─ errors.test.ts             # mapCoreErrorToCliError
```

### 5.2 Pure helpers

`resolveStorePath(input: { storeFlag?: string; xdgDataHome?: string; home: string }): string`
takes the relevant environment slice (no direct `process.env` read
inside the helper), applies §4.3 precedence, and returns an
absolute path. Empty `storeFlag` is rejected with a typed CLI
error (§4.7) before the helper is reached.

`formatProjectLine(project: Project): string` returns
`` `${project.id}  ${project.name}` ``. Pure, no I/O, fully unit
tested.

### 5.3 Store context (`store/context.ts`)

`ensureStoreReady(rootDir: string)` does the following, in order:

1. Probe the layout: check whether `rootDir`, `<rootDir>/projects.json`,
   and `<rootDir>/sessions.json` exist.
2. Compute `initialized = !(rootDirExists && projectsExists && sessionsExists)`.
3. Call `@megasaver/core`'s `initStore(rootDir)` unconditionally.
   `initStore` is idempotent (§5.5), so calling it when nothing is
   missing is a no-op.
4. Return:

   ```ts
   {
     registry: CoreRegistry;        // from createJsonDirectoryCoreRegistry
     initialized: boolean;          // true iff step 1 found anything missing
   }
   ```

The `initialized` flag drives the `note:` stderr line in §4.4.
`ensureStoreReady` itself never writes to stdout or stderr — the
calling handler is responsible for printing the notice. This keeps
the helper pure with respect to user-facing output and trivially
testable.

### 5.4 Error mapping (`errors.ts`)

`mapCoreErrorToCliError(err: unknown): { message: string; exitCode: 1 }`
is the single funnel from Core's typed error union (and Zod
validation failures) to the §4.7 table. The CLI handlers wrap
their Core calls in a `try`/`catch` that delegates to this helper,
write the message to `process.stderr`, and exit with the returned
code. No raw stack traces reach the user.

### 5.5 `@megasaver/core` change

A single new public export is required:

```ts
export function initStore(rootDir: string): Promise<void>;
```

Behavior:

- If `rootDir` does not exist, recursively create it.
- If `projects.json` does not exist inside `rootDir`, create it
  containing the literal `[]`.
- If `sessions.json` does not exist inside `rootDir`, create it
  containing the literal `[]`.
- If both files already exist, do nothing.
- Never overwrite an existing `projects.json` or `sessions.json`,
  even if the file is corrupt or contains unrelated content.
  Detection of corruption remains the responsibility of
  `createJsonDirectoryCoreRegistry` and surfaces through its
  existing typed errors.
- Throw the existing typed persistence error union on I/O failure.

The function is idempotent across repeated invocations against the
same rootDir.

This addition does not change the existing
`createJsonDirectoryCoreRegistry` contract. The function is
exported alongside it in `packages/core/src/index.ts`.

## 6. Testing strategy

TDD is mandatory (CLAUDE.md §4). Every behavior gets a failing
test before the production change.

### 6.1 Pure unit tests

- `apps/cli/test/store.test.ts` (`resolveStorePath`)
  - flag wins over XDG and HOME.
  - `XDG_DATA_HOME` set and non-empty wins over HOME.
  - HOME-derived fallback when XDG is missing or empty.
  - relative `--store` resolves against the supplied process cwd.
  - empty / whitespace-only `--store` is rejected at the boundary.
- `apps/cli/test/project.test.ts` (`formatProjectLine`)
  - canonical `<id>  <name>` rendering with two ASCII spaces.
  - names containing whitespace remain verbatim (no quoting).
- `apps/cli/test/errors.test.ts` (`mapCoreErrorToCliError`)
  - each row of the §4.7 table maps to the documented message.
  - unknown errors do not pass through unwrapped.

### 6.2 Integration tests (temporary store directory)

Integration tests live in the same flat test files alongside the
unit tests (`store.test.ts` and `project.test.ts`). Each test
creates its own temp directory under `os.tmpdir()` and tears it
down on completion. No test ever touches the real XDG path.

- `store.test.ts` (`ensureStoreReady`)
  - empty parent dir → both files created, `initialized: true`.
  - already-initialized dir → no file mutation, `initialized: false`.
  - partial dir (only `projects.json`) → completes the missing
    file without overwriting the existing one,
    `initialized: true`.
- `project.test.ts` (handlers)
  - `create` against an empty store: returns exit `0`, stdout
    matches `^<uuid>  demo\n$`, `projects.json` contains exactly
    one entry with the expected shape.
  - `list` against empty store: stdout empty, exit `0`.
  - `list` against populated store: prints in `projects.json`
    array order.
  - first invocation prints exactly one `note: initialized store at …`
    line on stderr; second invocation against the same dir prints
    none.
  - duplicate name: second `create` with the same name exits `1`,
    prints `error: project "demo" already exists` on stderr, and
    leaves `projects.json` unchanged (still one entry).

### 6.3 Core test

- `packages/core/test/init-store.test.ts`
  - new directory is created with both JSON files containing `[]`.
  - existing directory with both files is left untouched (byte
    equality before and after).
  - existing directory with only one file gains the missing one,
    other file untouched.
  - `initStore` is idempotent across two consecutive calls.

### 6.4 Smoke

After `pnpm build`, a manual sequence is captured for the wiki:

```bash
SMOKE_STORE="$(mktemp -d -t megasaver-smoke.XXXXXX)"
node apps/cli/dist/cli.js project list --store "$SMOKE_STORE"
node apps/cli/dist/cli.js project create demo --store "$SMOKE_STORE"
node apps/cli/dist/cli.js project list --store "$SMOKE_STORE"
rm -rf "$SMOKE_STORE"
```

Expected: empty stdout on the first `list` (and a single
`note: initialized store at <path>` line on stderr); `<uuid>  demo`
on stdout from `create`; the same `<uuid>  demo` line from the
second `list` with no further stderr notice.

## 7. Definition of Done (project-specific)

In addition to CLAUDE.md §9 generic items:

- `pnpm --filter @megasaver/core test` and
  `pnpm --filter @megasaver/cli test` pass.
- `pnpm verify` is green from a clean checkout.
- Every behavior in §4 has at least one test from §6.
- The §6.4 smoke evidence is captured in the wiki entry update for
  `@megasaver/cli`.
- A changeset is added for the new `initStore` core export.
- No changeset is added for `@megasaver/cli` (still `private: true`).

## 8. Compatibility

`@megasaver/core`'s `initStore` export is additive. Existing
consumers of `createJsonDirectoryCoreRegistry` see no behavioral
change. CLI users who only run `mega doctor` see no change.

The `--store` flag is new and lives at the root command. It is
ignored by `doctor`, so adding it does not regress `doctor`
behavior or its existing tests.

## 9. Security and privacy

The CLI writes only to the resolved store directory. It never
reads or writes outside that directory. Project names are written
verbatim to JSON; users are responsible for what they place in
them. Filesystem permissions follow the OS default for the
process. No network calls. No telemetry.

## 10. Documentation

- `wiki/entities/cli.md` is updated post-merge to describe
  `mega project create` and `mega project list`, the XDG default,
  and the `--store` flag.
- `wiki/entities/core.md` is updated to mention the new
  `initStore` export.
- `wiki/log.md` records ingest entries for this spec and its
  plan, plus a `schema` entry for the merge.
- The CLI `--help` output (Citty-generated) is the only
  user-facing reference shipped in v0.1.

## 11. Out of scope (future specs)

- `mega project get <id>`, `mega project update`, `mega project
  delete` — `delete` requires a separate decision on cascading
  Sessions and MemoryEntries.
- `mega session …` and `mega memory …` commands.
- `--json` machine-readable output.
- A standalone `mega init` command.
- An `MEGASAVER_STORE` environment variable.
- Windows path resolution (e.g. `%APPDATA%\megasaver`).
- Connector wire-up (`@megasaver/connectors/claude-code`,
  `@megasaver/connectors/generic-cli`).
- Slug fields, free-text search, or any indexing on top of the
  flat JSON layout.
- ANSI color, table formatting, or shell completion scripts.
- Unicode normalization (NFC vs NFD) — names are stored verbatim in the trimmed, control-char-free form they were submitted in. v0.2 may add canonicalization.

## 12. Open questions

None. All major decisions were resolved during the brainstorming
session that produced this spec.
