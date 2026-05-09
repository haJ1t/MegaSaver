---
title: mega connector sync — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-06-claude-code-connector-design.md
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - docs/superpowers/specs/2026-05-08-cli-session-crud-design.md
  - wiki/entities/connectors-shared.md
  - wiki/entities/connectors-claude-code.md
  - wiki/entities/connectors-generic-cli.md
---

# `mega connector sync` — design

## §0 TL;DR

Add a single CLI subcommand, `mega connector sync <projectName>`, that
writes Mega Saver context blocks into the agent files declared by the
shipped `ConnectorTarget` set (claude-code → `CLAUDE.md`, codex →
`AGENTS.md`). For each known target the command:

1. reads the existing file (`null` on ENOENT),
2. picks the latest open session for the target's `agentId`,
3. builds a `ConnectorContext` (memory entries empty in v0.1),
4. computes the new block via `upsertBlock` / `renderBlock`,
5. skips if the file is unchanged (`noop`), creates if missing and
   the user opted in (`--target <id>`), or writes the diff (`wrote`).

The command closes the value loop the connector packages have
promised since v0.1: Project + Session live in the registry; the
agent's project file reflects them.

## §1 Motivation

`@megasaver/connectors-shared`, `@megasaver/connector-claude-code`,
and `@megasaver/connector-generic-cli` shipped on `main` (PRs #6, #8,
#9). Their public surfaces — `syncTargetBlock`, `syncClaudeMdContext`,
`syncGenericCliTarget` — are dead from a user's perspective: there
is no CLI verb that wires a stored `Project` + `Session` into those
helpers. The connectors' wiki pages explicitly defer this: "CLI
integration (`mega connector sync` lands later)" (`wiki/entities/
connectors-generic-cli.md`).

Without this command:
- Mega Saver cannot demonstrate its core promise ("less tokens. more
  signal. same or better agent performance.") — the agent never
  reads the Mega Saver block because nothing writes it.
- v0.2 features (`mega connector status`, MemoryEntry rendering,
  Cursor/Aider targets) all assume a single sync path that doesn't
  yet exist.

## §2 Scope

### In scope

- `mega connector` parent command + `sync` subcommand.
- Target set (CLI-local, hardcoded): claude-code (`CLAUDE.md`) +
  codex (`AGENTS.md`). Codex entry **is** the existing
  `codexTarget` from `@megasaver/connector-generic-cli`'s
  `builtinTargets`. Claude-code entry is declared inline in CLI
  because the dedicated `connector-claude-code` package today
  exposes a path constant (`CLAUDE_MD_FILE`) and a composite
  `syncClaudeMdContext` helper but no `ConnectorTarget`-shaped
  descriptor.
- Per-target sync algorithm using `connectors-shared` primitives
  (`readTargetFile`, `renderBlock`, `upsertBlock`, `writeTargetFile`).
- Project name → ProjectId resolution inline in the CLI handler
  (NFC-normalized via the existing `projectNameSchema`).
- Session selection: latest open session whose `agentId` matches
  the target's `agentId`. `null` if no match.
- Memory entries: project-scoped entries (always) plus
  session-scoped entries belonging to the target's currently-
  picked open session (`pickLatestOpenSession`). Other agents'
  session-scoped memory is filtered out so each block reflects
  only the relevant context.
- Output: per-target line on stdout, errors to stderr.
- Best-effort partial failure: continue past per-target errors;
  exit 1 if any failed.
- Idempotent re-runs: status `noop` when the rendered block matches
  the existing block byte-for-byte; no file write.
- `--target <id>` flag: opt-in to seed a target file that does not
  already exist. Default behaviour is "skip non-existing files".

### Out of scope (deferred)

- MemoryEntry CLI integration. Memory rendering stays empty until
  the `mega memory` slice lands; sync passes `memoryEntries: []`.
- `mega connector status` (read-only inspection).
- `--all` flag (current default already syncs every existing
  target; flag is redundant).
- `--dry-run` (idempotency already exposes the same information:
  rerun shows `noop` when no change).
- Cursor `.cursor/rules/*.mdc` and Aider `.aider.conf.yml` targets.
  Each gets its own connector or generic-cli `ConnectorTarget`
  spec.
- JSON output flag (single-pass v0.2 covers all CLI commands).
- Per-project manifest (`.megasaver/connectors.json`). v0.2 if
  per-project agent selection becomes a real friction.
- Cross-process locking on the agent files. v0.1 single-developer
  scope: the connectors-shared `writeTargetFile` already does
  temp-file + rename which protects against partial writes within
  one process.
- Concurrent run detection (two `mega connector sync` invocations
  on the same projectRoot). Same v0.1 single-developer rationale.

## §3 Design

### §3a Architecture choice

The CLI handler orchestrates `connectors-shared` primitives
**directly**. It does not import `@megasaver/connector-claude-code`
or `@megasaver/connector-generic-cli`.

Rationale:
- Lowest coupling: CLI grows by one shared dependency it already
  uses transitively, no new package edges.
- The per-agent packages still serve programmatic consumers
  (`syncClaudeMdContext`, `syncGenericCliTarget`). They keep their
  composite shape; the CLI just bypasses them in favour of finer-
  grained primitives so it can implement the diff-and-skip logic
  cleanly.
- Symmetric: every target shares the same algorithm; the only
  per-target data is `(id, agentId, relativePath)` plus the
  schema's agent-specific refinement.

The two alternatives considered (dispatch to per-package composite
syncs; build a new orchestrator inside `connectors-shared`) are
rejected on the same ground: more code edges than v0.1 needs.

### §3b Target registry

Defined inline in `apps/cli/src/commands/connector.ts`:

```ts
import {
  type ConnectorTarget,
  codexTarget,
} from "@megasaver/connector-generic-cli";

const CLAUDE_CODE_TARGET: ConnectorTarget = {
  id: "claude-code",
  agentId: "claude-code",
  relativePath: "CLAUDE.md",
};

const KNOWN_TARGETS: readonly ConnectorTarget[] = [
  CLAUDE_CODE_TARGET,
  codexTarget,
];
```

The CLI does import `codexTarget` from the generic-cli package
because that target descriptor is the single source of truth for
the codex target's relativePath. The claude-code descriptor is
declared inline rather than added to the dedicated claude-code
package, because the package's surface is already shipped on
`main` and adding a new export there would expand the public
contract for one consumer.

`KNOWN_TARGETS` order is the iteration order; output appears in
this order. v0.2 additions (cursor, aider) append.

### §3c Project name → ProjectId resolution

Inline in the handler, identical to the pattern locked in CLI
Session CRUD §3a: `registry.listProjects().find((p) => p.name ===
projectName)` after NFC-normalising the input via the existing
`projectNameSchema`. `null` → `projectNotFoundMessage(projectName)`.

### §3d Per-target sync algorithm

Before the loop, validate the project root exactly once via the
shared helper:

```
await assertProjectRoot(project.rootPath)   // throws target_path_invalid
```

This produces a single, clean `target_path_invalid` failure when
the project's `rootPath` is missing or not a directory, instead of
N per-target ENOENT failures from the per-target write step. The
shared helper is async (Promise<void>) — it runs `stat` under the
hood (`packages/connectors/shared/src/filesystem.ts`). The check
runs after the project resolution but before the target loop. If
it throws, the CLI surfaces the documented stderr message and
exits 1 without printing any per-target line.

Pseudocode, executed once per target in `KNOWN_TARGETS`:

```
for target of KNOWN_TARGETS:
  absPath = path.join(project.rootPath, target.relativePath)
  existing = await readTargetFile(absPath)               // null on ENOENT

  if existing === null && (--target flag != target.id):
    print:  `${target.id}  ${target.relativePath}  skipped`
    continue

  session = pickLatestOpenSession(registry, project.id, target.agentId)
  context = {
    agentId: target.agentId,
    project,
    session,                  // Session | null
    memoryEntries: [],
  }
  assertConnectorContext(context)        // throws ConnectorError

  newContent =
    existing === null
      ? renderBlock(context)
      : upsertBlock({ existingContent: existing, context })

  if existing !== null && newContent === existing:
    print:  `${target.id}  ${target.relativePath}  noop`
    continue

  await writeTargetFile({ absPath, content: newContent })
  status = existing === null ? "created" : "wrote"
  print:  `${target.id}  ${target.relativePath}  ${status}`
```

`pickLatestOpenSession`:

```
sessions = registry.listSessions(projectId)
candidates = sessions.filter(s => s.endedAt === null && s.agentId === agentId)
return candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
```

`startedAt` is RFC 3339; lexicographic sort is correct for this
format.

### §3e Output format

Per-target line on stdout:

```
<target.id>  <target.relativePath>  <status>
```

Two spaces between fields (matches `mega session list`'s
`<id>  <agent>  <risk>  <title>` pattern). Status is one of:
`wrote`, `noop`, `created`, `skipped`, `error`. No header line, no
summary line.

When a per-target step throws, the line is:

```
<target.id>  <target.relativePath>  error
```

…and the human-readable detail (`error: ...`) is emitted to
stderr immediately after, so an interactive user sees both. A
script piping stdout sees only the status table; a script
capturing stderr sees the failure reasons.

Exit code: `0` if every target's status is non-error, `1` if any
target ended in `error`.

### §3f CLI delta

#### New file `apps/cli/src/commands/connector.ts`

Follows the locked CLI handler test pattern (`wiki/workflows/
cli-test-pattern.md`). Public exports:

- `runConnectorSync(input: RunConnectorSyncInput): Promise<0 | 1>`
- `connectorSyncCommand` (Citty `defineCommand`)
- `connectorCommand` (parent with `sync` subcommand only)

`RunConnectorSyncInput` shape:

```ts
export type RunConnectorSyncInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
```

No `now` / `newId` injection: the handler does not generate ids or
timestamps. Tests inject behaviour by seeding the store and reading
the on-disk agent files after the call.

#### `apps/cli/src/main.ts`

Register `connector: connectorCommand` in the `subCommands` block
of `mainCommand`, alongside `doctor`, `project`, `session`.

#### `apps/cli/src/errors.ts`

The shared error mapping already covers the helpers we'll throw at
or surface from this command:
- `projectNotFoundMessage(name)` — already exported (PR #11/#12).
- `ZodError + { kind: "name" }` — for the `projectName` parse path.
- `ConnectorError` (shared package) — currently has no CLI mapping
  because nothing in the CLI throws it yet. We need to extend
  `mapErrorToCliMessage` to recognise `ConnectorError` and surface
  its code:
  - `context_invalid` → `error: connector context invalid for
    target "<id>": <message>`
  - `block_conflict` → `error: connector block conflict in
    <relativePath>: <message>` (the underlying message already
    includes line numbers per F8 in PR #9).
  - `file_read_failed` / `file_write_failed` → `error: connector
    failed to read/write <relativePath>: <message>`.
  - `target_path_invalid` → `error: project root invalid:
    <message>`.

The `mapErrorToCliMessage` extension takes a new `ZodContext`
variant `{ kind: "connector"; targetId: string; relativePath: string
}` so the handler can pass per-target context when wrapping the
shared error into a CLI message. Default fall-through (no
`kind: "connector"` ctx) surfaces `error: <connector code>:
<message>` to keep symmetry with the project / session paths.

### §3g Command surface

```
mega connector sync <projectName> [--target <id>] [--store <dir>]
```

- `<projectName>` — positional, required, NFC-normalised. Same
  schema as `mega session create / list`.
- `--target <id>` — optional. Exactly one of the `KNOWN_TARGETS`
  ids (`"claude-code"` or `"codex"`). When present and the named
  target's file does not exist on disk, the file is created
  (`status: created`). When absent, missing files are skipped
  (`status: skipped`). The flag does NOT restrict the iteration to
  one target: every known target is still attempted; the flag only
  permits creation of one specific missing file. (Rationale: most
  flows need full sync after a state change; the flag is a
  one-time seeding switch.)
- `--store <dir>` — same semantics as the other commands (see
  `wiki/entities/cli.md`).

### §3h Validation rules

- `<projectName>` rejects empty, control characters (C0/C1, DEL),
  via the reused `projectNameSchema` from `commands/session.ts`.
- `--target <id>` rejects unknown ids with the message
  `error: invalid target "<value>", expected: claude-code | codex`.
  The list mirrors `KNOWN_TARGETS.map(t => t.id).join(" | ")`; a
  small `invalidTargetMessage` helper is added to
  `apps/cli/src/errors.ts`. Drift guard via
  `as const satisfies readonly string[]` on the literal.
- `assertConnectorContext` (shared) is invoked on the assembled
  context before any I/O; failure surfaces as a per-target `error`.

## §4 Errors

| Path                                  | Source                                  | CLI text                                                                       |
|---------------------------------------|-----------------------------------------|--------------------------------------------------------------------------------|
| empty / control-char projectName      | `projectNameSchema.parse`               | existing `name must be non-empty` / `name must not contain control characters` |
| invalid `--target`                    | local validation                        | `error: invalid target "<value>", expected: claude-code \| codex`              |
| unknown project                       | resolver inline                         | `error: project "<name>" not found`                                            |
| connector context invalid             | `assertConnectorContext`                | per-target line `error`; stderr `error: connector context invalid for target "<id>": <message>` |
| sentinel injection in rendered field  | `assertConnectorContext` `context_invalid` | same as above; underlying message already names the offending field            |
| existing file has duplicate sentinels | `parseBlock` `block_conflict`           | per-target line `error`; stderr `error: connector block conflict in <relativePath>: <message>` |
| read I/O failure (not ENOENT)         | `readTargetFile` `file_read_failed`     | per-target line `error`; stderr `error: connector failed to read <relativePath>: <message>` |
| write I/O failure                     | `writeTargetFile` `file_write_failed`   | per-target line `error`; stderr `error: connector failed to write <relativePath>: <message>` |
| symlink at target path                | `writeTargetFile` `file_write_failed`   | same as above (the shared write helper rejects symlink replacement)            |
| project rootPath does not exist       | `assertProjectRoot` `target_path_invalid` | pre-loop check; no per-target lines; stderr `error: project root invalid: <message>` |
| store I/O / persistence               | `CorePersistenceError`                  | existing CLI funnel (`error: store at <path> is corrupt: ...` etc.)            |

Exit `1` if any target ends in `error`, else `0`.

## §5 Tests

Two layers, mirroring the locked CLI test pattern.

### Unit (CLI handler) — `apps/cli/test/connector.test.ts`

Each test mkdtemps a fresh `--store` root + a fresh `projectRoot`
(passed as the project's `rootPath` when seeding). The store
directory and the projectRoot are independent: the store holds
`projects.json` / `sessions.json`, while the projectRoot holds
`CLAUDE.md` / `AGENTS.md`.

Cases:

1. **Happy path, two targets, both files exist** — seed project
   with `rootPath = projectRoot`, seed `CLAUDE.md` + `AGENTS.md`
   each with a Mega Saver block bearing an old project id; seed
   one open claude-code session and one open codex session;
   `runConnectorSync` updates both files; stdout is two lines
   ending in `wrote`; both files now contain the new project id.

2. **Idempotent rerun** — repeat case 1's invocation; stdout is
   two lines ending in `noop`; mtimes preserved (assert mtime
   equality before/after).

3. **Mixed: one wrote, one noop** — bump only the claude-code
   session title; rerun; stdout is `claude-code  CLAUDE.md  wrote`
   then `codex  AGENTS.md  noop`.

4. **Skipped non-existing target** — projectRoot only contains
   `CLAUDE.md`; `AGENTS.md` does not exist. Sync without
   `--target`. Status: `claude-code  CLAUDE.md  wrote`, then
   `codex  AGENTS.md  skipped`. `AGENTS.md` is NOT created.

5. **Created via `--target codex`** — same setup as case 4 but
   with `--target codex`. Status: `claude-code  CLAUDE.md  wrote`,
   then `codex  AGENTS.md  created`. `AGENTS.md` now exists with
   only the Mega Saver block.

6. **Per-target error continues, exit 1** — make `AGENTS.md`
   contain a duplicate sentinel (forces `block_conflict`). Sync.
   Status: `claude-code  CLAUDE.md  wrote` and `codex  AGENTS.md
   error` on stdout; stderr carries the connector message; exit 1.

7. **Latest-open session per agent** — seed three sessions for
   the project: an ENDED claude-code at 10:00, an OPEN claude-code
   at 12:00, and an OPEN codex at 13:00. Sync. Render the
   resulting CLAUDE.md → it must contain the 12:00 session id;
   AGENTS.md → the 13:00 session id.

8. **No matching open session → null in context** — seed only
   ENDED sessions for both agents. Sync (case 4 setup). Block
   renders `Session: none` (the connectors-shared rendering
   convention).

9. **Unknown project rejected** — sync with a name not in the
   store; stdout empty; stderr `error: project "<name>" not
   found`; exit 1; no file changes.

10. **Invalid `--target` rejected** — sync with `--target nope`;
    stdout empty; stderr `error: invalid target "nope", ...`;
    exit 1; no file changes.

11. **NFD project name resolves to NFC** — seed project with NFC
    name `café` (U+00E9); sync with NFD input `café`; resolves to
    the same project; happy path completes.

12. **Empty projectRoot directory** — projectRoot exists, no
    files inside, no `--target`. Stdout: two `skipped` lines;
    exit 0; nothing created.

13. **`assertProjectRoot` rejects non-existent rootPath** — seed
    project with `rootPath` pointing to a path that does NOT
    exist on disk (e.g. `/tmp/megasaver-not-here-${rand}`). Sync.
    Stdout is empty (the loop never runs because the pre-loop
    `assertProjectRoot` throws). Stderr surfaces `error: project
    root invalid: ...`; exit 1.

### Errors module — `apps/cli/test/errors.test.ts`

Append:

- `invalidTargetMessage("nope")` returns the documented string +
  `exitCode: 1`.
- `mapErrorToCliMessage` with a `ConnectorError("context_invalid",
  ...)` and `{ kind: "connector", targetId: "claude-code",
  relativePath: "CLAUDE.md" }` returns the per-target stderr text.
- Same for `block_conflict`, `file_read_failed`,
  `file_write_failed`, `target_path_invalid`.

### Smoke evidence

`pnpm build` then a manual two-target run on a temp store +
projectRoot, captured into the PR description:

```
SMOKE_STORE=$(mktemp -d)
SMOKE_PROJ=$(mktemp -d)
node apps/cli/dist/cli.js project create demo --store "$SMOKE_STORE"
# manually edit projects.json so the demo project's rootPath = $SMOKE_PROJ
node apps/cli/dist/cli.js session create demo --agent claude-code --title "smoke" --store "$SMOKE_STORE"
node apps/cli/dist/cli.js connector sync demo --target claude-code --store "$SMOKE_STORE"
node apps/cli/dist/cli.js connector sync demo --store "$SMOKE_STORE"      # noop x2
```

(The `rootPath` edit is awkward — `mega project create` currently
defaults `rootPath = process.cwd()`. v0.2 may add `mega project
create --root <dir>`. Out of scope here; the smoke is a manual
edit one-off.)

## §6 Risk + non-goals

Risk **MEDIUM**. Justification:
- First CLI command that mutates user files. Two files at most,
  one project at a time. Not "user files at scale" per CLAUDE.md
  §12 HIGH trigger. Reviewers may upgrade to HIGH.
- All write-side primitives (`writeTargetFile`, `upsertBlock`,
  `parseBlock`, `assertProjectRoot`) are already test-covered in
  `@megasaver/connectors-shared` (PR #8/#9). The CLI's job is
  glue + diff-and-skip + per-target reporting.
- Worktree mandatory (`feat/mega-connector-sync`). Full superpowers
  chain. `code-reviewer` required pre-merge.
- Author and reviewer NEVER same active context (CLAUDE.md §9).

Non-goals already enumerated in §2 "Out of scope".

## §7 Open questions / future

- v0.2: `mega project create --root <dir>` (or `mega project
  edit`) so the smoke flow doesn't need a manual `projects.json`
  edit.
- v0.2: `mega connector status <projectName>` — read-only
  inspection of what the next sync would do. Separate spec.
- v0.2: per-project manifest (`.megasaver/connectors.json`) once
  per-project agent selection becomes a real friction.
- v0.2: cross-process locking on the agent files themselves (not
  just the registry's `.projects.lock`). Two concurrent
  `mega connector sync` invocations from two terminals could
  interleave block writes; current write is temp-file + rename so
  the worst case is "last writer wins, no partial bytes".
- v0.2: MemoryEntry CLI integration. When `mega memory add` lands,
  the sync's `memoryEntries` field becomes a real selection, not
  `[]`. Memory selection logic (which 20? sort? scope filter?)
  is its own design pass.
- v0.2: `--json` output flag, in lockstep with the other CLI
  commands.
- v0.3: Cursor `.cursor/rules/*.mdc` and Aider `.aider.conf.yml`
  targets. Each adds a `ConnectorTarget` entry plus any
  per-target schema refinement.
