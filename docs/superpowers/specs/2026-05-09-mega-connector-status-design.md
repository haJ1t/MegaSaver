---
title: mega connector status — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md
  - docs/superpowers/specs/2026-05-06-claude-code-connector-design.md
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - wiki/entities/cli.md
  - wiki/entities/connectors-shared.md
---

# `mega connector status` — design

## §0 TL;DR

Add a read-only CLI subcommand,
`mega connector status <projectName> [--target <id>]`, that reports
whether each known agent file is in sync with what `mega connector sync`
would currently write. For each `ConnectorTarget` the command reads the
existing file, parses any sentinel block, and compares against the
freshly rendered block. It prints one line per target with a status
word from a closed set:

- `in-sync` — file exists, block exists, byte-equal to the freshly
  rendered block.
- `drift` — file exists, block exists, but content differs from the
  freshly rendered block.
- `no-block` — file exists but contains no Mega Saver sentinel block.
- `missing` — file does not exist.
- `error` — read failed, or `parseBlock` threw `block_conflict`.

The command never writes. Exit code is `1` when any target reports
`drift`, `no-block`, or `error`; otherwise `0`.

## §1 Motivation

`mega connector sync` (PR #14, merge `204f922`) closed the write loop:
Project + Session in the registry → block written to each known
agent file. The complement is missing: a way to ask "is the block
currently in sync?" without mutating anything. Use cases:

- **CI gate.** A repo can run `mega connector status` after writes
  in another tool to detect manual edits inside the sentinel block.
- **Smoke check.** A user newly registers a project and wants to
  confirm which agent files already have a block before running
  `sync`.
- **Drift triage.** When a session changes, the user can confirm
  which target files need a re-sync without writing them yet.

The command also serves as the first real consumer of
`parseBlock` from `@megasaver/connectors-shared` outside `upsertBlock`.

## §2 Non-goals

- No write path. v0.1 strictly read-only.
- No drift reason payload (which field changed). The status word is
  the contract; richer detail is deferred to a future
  `mega connector diff`.
- No `--json` flag. Cross-cutting JSON output is a separate slot.
- No multi-block detection beyond what `parseBlock` already throws
  (`block_conflict` is collapsed into `error`).
- No new connector target. Same `KNOWN_TARGETS` as
  `mega connector sync` (`claude-code`, `codex`).

## §3 Surface

```text
mega connector status <projectName> [--target <id>] [--store <dir>]
```

Positional:
- `projectName` (required) — resolved against the store by name.
  Same NFC-normalised, control-char-rejecting `projectNameSchema` as
  the rest of the CLI. Unknown name → existing
  `projectNotFoundMessage` (`project_not_found`, exit 1).

Flags:
- `--target <id>` — optional filter. When provided, the per-target
  loop is restricted to the single matching target. Unknown id →
  existing `invalidTargetMessage` (`unknown_connector_target`,
  exit 1). The set of known ids is the existing
  `KNOWN_TARGET_IDS = ["claude-code", "codex"] as const` from
  `apps/cli/src/errors.ts`.
- `--store <dir>` — optional store override (same semantics as
  the `project` and `session` subcommands).

The store is initialised on demand via `ensureStoreReady` (same
notice on stderr as the rest of the CLI:
`note: initialized store at <path>`).

`assertProjectRoot(project.rootPath)` runs once before the per-target
loop; on failure the command emits a single error message and exits 1
(no per-target lines printed). This matches the pre-loop guard
established by `mega connector sync`.

## §4 Output

One line per evaluated target on stdout:

```text
<id>  <relPath>  <status>  session=<id|none>
```

Format details:

- The id column pads to the existing `TARGET_ID_COLUMN_WIDTH` (the
  same constant `mega connector sync` uses, derived from
  `KNOWN_TARGETS`). Two-space gutter between columns. Path column is
  not padded; status follows after the path with a two-space gutter;
  the session field follows the status with a two-space gutter and
  the literal prefix `session=`.
- `status` is one of the five closed-set words listed in §0.
- `session=<id>` is the id of the latest open session whose `agentId`
  matches the target (same `pickLatestOpenSession` rule as sync).
  When no such session exists the field renders `session=none`.
- Lines are emitted in `KNOWN_TARGETS` declaration order. With
  `--target <id>` only the matching line is emitted.

Every status word — including `error` — emits the session suffix. The
session is the latest open session for the target's `agentId`, or `none`
if no such session exists.

Worked example (claude-code in sync, codex with no block, project has
one open claude-code session `01HXY...`):

```text
claude-code  CLAUDE.md  in-sync  session=01HXY...
codex        AGENTS.md  no-block  session=none
codex        AGENTS.md  error  session=none
```

> Note: the three lines above are from three separate invocations of
> `mega connector status`, each illustrating one possible outcome. A
> single real invocation emits one line per target (two lines for the
> default two-target set), not three.


Stderr is reserved for:
- the optional store-init notice,
- pre-loop errors (`project_not_found`, `unknown_connector_target`,
  `assertProjectRoot` failure, store-resolve failure),
- per-target `error` rows: a single mapped CLI message via
  `mapErrorToCliMessage(err, { kind: "connector", targetId,
  relativePath })`.

## §5 Status decision rules

For each target the decision is computed as follows. `existing` is the
result of `readTargetFile(absPath)`; `null` means ENOENT.

```text
if existing is null:
  status = "missing"
else:
  parsed = parseBlock(existing)        // throws ConnectorError(block_conflict)
  if parsed.block is null:
    status = "no-block"
  else:
    context  = buildConnectorContext(target, project, sessions)
    upserted = upsertBlock({ existingContent: existing, context })
    status   = upserted === existing ? "in-sync" : "drift"
```

If `readTargetFile` or `parseBlock` throws (or any other unexpected
error in the per-target body), the per-target try/catch sets status
to `error`, prints the line, prints the mapped CLI message on stderr,
and continues to the next target. This matches the best-effort
partial-failure semantics of `mega connector sync`.

Why `upsertBlock` and not direct render-comparison: `upsertBlock`
already encapsulates the exact write `mega connector sync` performs.
Re-using it keeps the two commands' notion of "in-sync" identical by
construction; any future sync change automatically propagates to
status. The `noop` case in `sync` (`newContent === existing`) is the
same predicate as `in-sync` here.

## §6 Exit code

After the per-target loop the command returns:

- `0` if every emitted line is `in-sync` or `missing`,
- `1` if any line is `drift`, `no-block`, or `error`.

Pre-loop failures (store resolve, project not found, unknown target,
assertProjectRoot) short-circuit before any line is emitted and exit
with their existing code (always `1` in the current `errors.ts`
mapping; nothing changes there).

`missing` is exit `0` because the file simply does not exist; the
user has not asked to create it (sync's `--target <id>` seed path
does not apply to status). `no-block` is exit `1` because if the file
exists, an empty (no Mega Saver content) state is treated as drift —
a `sync` run would now insert a fresh block.

## §7 Code organisation

Single file extension. New code lives in
`apps/cli/src/commands/connector.ts` alongside `runConnectorSync`.

- The existing module-private constants
  (`KNOWN_TARGETS`, `TARGET_ID_COLUMN_WIDTH`, `formatStatusLine`,
  `pickLatestOpenSession`, `buildConnectorContext`,
  `projectNameSchema`, `isKnownTargetId`) are reused as-is. Their
  visibility does not need to change; both `runConnectorSync` and
  `runConnectorStatus` live in the same module.
- `formatStatusLine` is extended to accept an optional `session` id
  string. Existing call sites (sync) pass `undefined`; the formatter
  appends the `  session=...` suffix only when provided. Sync output
  is therefore byte-identical to today.
- New exported `RunConnectorStatusInput` mirrors
  `RunConnectorSyncInput` exactly (same fields). New exported
  `runConnectorStatus(input): Promise<0 | 1>`.
- New `connectorStatusCommand` Citty `defineCommand`. Same flag set
  minus the seed semantics on `--target`. Wired into
  `connectorCommand.subCommands` next to `sync`.

`apps/cli/src/main.ts` does not change (`connectorCommand` already
registered).

`apps/cli/src/errors.ts` does not change. The five existing
ConnectorError codes (`context_invalid`, `block_conflict`,
`file_read_failed`, `file_write_failed`, `target_path_invalid`) cover
every error the read path can produce; the existing `kind: "connector"`
ZodContext variant is the right routing for the per-target catch.

`packages/connectors/shared` does not change. `parseBlock` and
`upsertBlock` are public and sufficient as-is.

## §8 Tests

New file: `apps/cli/test/connector-status.test.ts`. Vitest, four
describe blocks plus one cross-target test. Each test injects a
temp-dir store and a temp-dir project root; both are cleaned up in
`afterEach`. Stdout/stderr are captured via `(line) => lines.push(line)`
sinks; assertions read the captured arrays.

1. **`pre-target gates`** (3 tests)
   - unknown project → exit 1, stderr contains `project_not_found`
     message, stdout empty.
   - unknown `--target` → exit 1, stderr contains
     `unknown_connector_target` message, stdout empty.
   - `assertProjectRoot` fails (rootPath does not exist) → exit 1,
     stderr contains the mapped message, stdout empty.

2. **`missing + no-block`** (3 tests)
   - both files absent → two `missing` lines, both with
     `session=none`, exit 0.
   - `CLAUDE.md` exists but contains no sentinel block → status
     `no-block`, exit 1.
   - `--target codex` filter with `AGENTS.md` absent → single line
     `missing`, exit 0; `claude-code` row not printed.

3. **`in-sync + drift`** (4 tests)
   - file written by `runConnectorSync` immediately before status →
     `in-sync`, exit 0.
   - file written by sync, then session ended (so the freshly built
     context picks `session=none`) → `drift`, exit 1.
   - file written by sync, then file's block content edited
     manually (single byte changed inside the block) → `drift`, exit
     1.
   - empty project (no sessions): file pre-seeded with a block whose
     `Session: none` matches → `in-sync`, exit 0.

4. **`error`** (2 tests)
   - file contains two begin sentinels (`block_conflict` from
     `parseBlock`) → status `error`, exit 1, stderr contains the
     mapped connector error message including the relative path.
   - file is unreadable (e.g. permission denied via
     `fs.chmod(path, 0o000)` then restored in `afterEach`) → status
     `error`, exit 1, stderr contains a mapped message; the loop
     continues to the next target.

5. **cross-target** (1 test)
   - claude-code `in-sync`, codex `drift` → both lines emitted in
     declaration order, exit 1.

`apps/cli/test/errors.test.ts` does not need new cases (no new error
codes). Test count delta: +13 tests on the CLI package, expected
totals 106 → 119.

## §9 Risk

MEDIUM. Read-only command, single-package change. Same risk class
as `mega connector sync` was on its second pass. Full superpowers
chain applies (TDD, code-reviewer, critic v0.2 follow-up pass), no
HIGH triggers (no Core change, no public surface beyond the CLI bin,
no destructive ops).

## §10 Out of scope (explicit)

- `--json` flag (separate cross-cutting slot).
- `mega connector diff` — drift reason / payload comparison.
- New connector targets (Cursor `.cursor/rules/*.mdc`, Aider YAML).
- Changing `formatStatusLine` to a structured value (kept as a string
  formatter; the optional session suffix is the only addition).
- Promoting `KNOWN_TARGETS` out of `connector.ts` into a shared
  module. Co-location is fine while there are exactly two consumers.
- Detecting orphaned sentinel pairs spread across a malformed file
  beyond what `parseBlock` already reports.
