---
title: CLI Session CRUD — design
risk: HIGH
status: draft
created: 2026-05-08
updated: 2026-05-08
related:
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
  - docs/superpowers/specs/2026-05-05-core-persistence-design.md
  - docs/superpowers/specs/2026-05-08-core-hardening-m3-m4-design.md
  - wiki/entities/core.md
  - wiki/entities/cli.md
---

# CLI Session CRUD — design

## §0 TL;DR

Add four CLI subcommands — `mega session create`, `mega session list`,
`mega session show`, `mega session end` — backed by the existing
`@megasaver/core` `Session` schema and registry. One new core
mutation method (`endSession`) and one new error code
(`session_already_ended`) are added; everything else reuses the
v0.1 surface (`createSession`, `getSession`, `listSessions`).

The slice mirrors the established `mega project create / list`
shape (Citty `defineCommand`, injected `now` / `newId` / `stdout`
/ `stderr`, NFC-normalized inputs, `mapErrorToCliMessage` funnel).
Risk **HIGH** because Core public surface grows and the CLI gains
mutating commands against a persistent store.

## §1 Motivation

`Session` schema, registry methods (`createSession`, `getSession`,
`listSessions`), and JSON persistence have all shipped (PRs #4,
#5, #9, #10). Sessions are not yet reachable from the user surface
— `apps/cli/src/commands/` only contains `doctor.ts` and
`project.ts`. The wiki `entities/cli.md` lists Session CRUD as the
explicit next slot.

Without these commands the platform cannot demonstrate its core
loop (project → session → context). v0.2 features (`mega connector
sync`, MCP bridge) all assume sessions are addressable from the
CLI.

## §2 Scope

### In scope

- Four new CLI subcommands under a `session` parent.
- Project-name → ProjectId resolution inline in CLI (NFC-normalized).
- One new `CoreRegistry` method: `endSession(id, opts)`.
- One new error code: `session_already_ended`.
- New CLI error mappings + `sessionAlreadyEndedMessage` helper.
- Tests at the same shape as `project.test.ts`.

### Out of scope (deferred)

- `mega session update` / generic patch (YAGNI).
- `--all` flag for `session list` (no cross-project listing).
- `--json` output flag (deferred to a single v0.2 pass over all
  commands; project commands also stay text-only).
- `mega session start <projectName> --resume <id>` style ergonomic
  shortcuts.
- Session pause/resume.
- Listing sessions of a deleted project (project deletion does
  not exist yet; deferred).
- MemoryEntry CLI commands (separate slice).

## §3 Design

### §3a Architecture choice — name resolution

The `session create` and `session list` commands take a project
**name**, not a UUID. Project names are unique (CLI-enforced in
`runProjectCreate`); resolution is therefore a one-line `find`.

Resolution lives **inline in each CLI handler**, not in
`@megasaver/core`. Rationale (CLAUDE.md §8 + `wiki/entities/core.md`
boundary rules):

> Core must not enforce display-layer policies (e.g. unique names)
> — that lives in CLI/connector.

Name uniqueness, name normalization-for-lookup, and the resulting
"project not found" CLI error are all display-layer concerns. If
a third caller appears (connectors, future commands), refactor to
a shared CLI helper in `apps/cli/src/projects.ts`. Two callers do
not justify the shared module yet.

### §3b Core delta — `packages/core/`

#### `endSession(id, opts): Session`

Add to the `CoreRegistry` interface in
`packages/core/src/registry.ts`:

```ts
endSession(id: SessionId, opts: { endedAt: string }): Session;
```

Semantics:

- Look up the session by `id`. Missing → throw
  `CoreRegistryError("session_not_found")` (existing code).
- If `endedAt !== null` → throw
  `CoreRegistryError("session_already_ended")` (new code).
- Otherwise set `endedAt = opts.endedAt`, persist, return the
  updated `Session` (Zod-parsed via `sessionSchema`).
- `opts.endedAt` MUST be RFC 3339 — Zod will reject otherwise via
  `CorePersistenceError("store_entity_invalid")`.

CLI passes `opts.endedAt = new Date().toISOString()` (injectable
in tests as `now`). The argument is explicit (not implicit `Date.now()`
inside Core) to keep Core deterministic and test-friendly, mirroring
the existing `createProject` / `createSession` pattern where the
caller supplies all timestamps.

#### `json-directory-registry.ts`

Implementation runs inside `withDirLock(rootDir, …)` (existing M1
+ M3 primitive). Steps:

1. Acquire lock.
2. Read `sessions.json` and parse the array.
3. Find session by id; throw `session_not_found` if absent.
4. If existing `endedAt !== null`, throw `session_already_ended`.
5. Build the updated object, parse via `sessionSchema.parse(...)`
   (re-validates RFC 3339 + NFC normalization).
6. Replace the entry in the array, write atomically (temp file
   + rename) — same pattern as `createSession`.
7. Release lock; return the parsed session.

#### In-memory registry

`createInMemoryCoreRegistry()` adds `endSession` with the same
semantics minus the lock (single-threaded, deterministic).

#### `errors.ts`

`CoreRegistryErrorCode` union gains `"session_already_ended"`. No
other code changes.

### §3c Shared delta — `packages/shared/`

None. `SessionId`, `AgentId`, `RiskLevel` already public.

### §3d CLI delta — `apps/cli/`

#### New file `apps/cli/src/commands/session.ts`

Mirrors `project.ts` shape:

- Pure handlers (`runSessionCreate`, `runSessionList`,
  `runSessionShow`, `runSessionEnd`) that take an injectable input
  type with `storeFlag`, `cwd`, `home`, `xdgDataHome`, `stdout`,
  `stderr`, plus `newId` / `now` overrides where relevant.
- Citty `defineCommand` wrappers (`sessionCreateCommand`,
  `sessionListCommand`, `sessionShowCommand`, `sessionEndCommand`).
- One parent `sessionCommand` with all four subcommands.
- One project name resolver (inline closure or local function):
  ```ts
  const projectNameSchema = z
    .string()
    .trim()
    .min(1)
    .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
    .transform((value) => value.normalize("NFC"));
  ```
  Used for `create` and `list`. Same NFC discipline as
  `nameSchema` in `project.ts` so NFD inputs from the terminal
  match stored canonical names.

#### `apps/cli/src/main.ts`

Register `session: sessionCommand` in the `subCommands` object of
`mainCommand`, alongside the existing `doctor` and `project`
entries.

#### `apps/cli/src/errors.ts`

Add to `mapErrorToCliMessage`:

- `session_not_found` → `error: session "<id>" not found`, exit 1.
- `session_already_ended` → handled via `sessionAlreadyEndedMessage`
  helper (called from CLI handler with the existing `endedAt`
  timestamp included for diagnostics):
  ```ts
  export function sessionAlreadyEndedMessage(
    id: string,
    endedAt: string,
  ): { message: string; exitCode: 1 } {
    return {
      message: `error: session "${id}" already ended at ${endedAt}`,
      exitCode: 1,
    };
  }
  ```
  Implementation note: the Core throw carries only the code, not
  the existing `endedAt`. To produce the rich CLI message, the
  handler reads the session via `getSession` first and constructs
  the message itself. `endSession` still validates inside the
  lock; in the rare race where a concurrent CLI invocation ends
  the session between our read and the call, Core throws
  `session_already_ended` and the CLI handler does a second
  `getSession` to refresh the timestamp before formatting the
  message. Two reads on the unhappy race path, one read on the
  common already-ended path, zero extras on the success path.

  Trade-off: keeps Core's error payload minimal (codes only, no
  contextual data). Same shape as the duplicate-name flow in
  `project.ts` (CLI checks existing names before calling
  `createProject`).

- `project_not_found` (existing code, new CLI usage in resolver)
  → `error: project "<name>" not found`, exit 1.

## §4 Commands (concrete)

### `mega session create <projectName> --agent <id> [--risk <level>] [--title <str>] [--store <dir>]`

- `<projectName>` — positional, required, NFC-normalized.
- `--agent` — required. Validates against `agentIdSchema`
  (`claude-code | codex | generic-cli`). Invalid →
  `error: invalid agent "<value>", expected: claude-code | codex
  | generic-cli`.
- `--risk` — optional, default `"medium"`. Validates against
  `riskLevelSchema` (`low | medium | high | critical`). Invalid
  produces a parallel error message.
- `--title` — optional, default `null`. NFC-normalized via the
  schema's existing `.transform`. Empty after trim → reject as
  with `name`.
- `--store` — same semantics as `mega project list/create`.

Behaviour:

1. Resolve store path (existing `resolveStorePath`).
2. Parse / validate inputs (project name, agent, risk, title).
3. `ensureStoreReady` — emits the `note: initialized store at
   <path>` once if needed.
4. Resolve project: `registry.listProjects()` then find by name;
   missing → `project_not_found` CLI error, exit 1.
5. Generate session id (`sessionIdSchema.parse((newId ?? randomUUID)())`),
   stamp `startedAt = (now ?? () => new Date().toISOString())()`,
   `endedAt = null`.
6. `registry.createSession({...})` — Core enforces strict Zod
   parse and lock.
7. `stdout(<sessionId>)` on success.

Output (success): single line, the new `<sessionId>`. Exit 0.

### `mega session list <projectName> [--store <dir>]`

- `<projectName>` — positional, required, NFC-normalized.
- `--store` — same as above.

Behaviour: resolve project (same as `create`), call
`registry.listSessions(project.id)`, print each session as
`<id>  <agentId>  <riskLevel>  <title|->`, two-space delimited.
Empty result → empty stdout (no header, no message). Project
not found → CLI error exit 1.

### `mega session show <sessionId> [--store <dir>]`

- `<sessionId>` — positional, required. Validated by
  `sessionIdSchema` (UUID). Invalid → `error: invalid session id
  "<value>"`, exit 1.

Behaviour: `registry.getSession(id)`. `null` → `session_not_found`
CLI error. Otherwise print seven lines, key=value with a 12-char
left-padded key column:

```
id          <id>
project     <projectId>
agent       <agentId>
risk        <riskLevel>
title       <title|->
startedAt   <startedAt>
endedAt     <endedAt|->
```

Two spaces between key column and value (post-padding). `null`
fields render as the literal `-`, matching `list` output.

### `mega session end <sessionId> [--store <dir>]`

- `<sessionId>` — positional, required, UUID-validated.

Behaviour:

1. Resolve store, ensure ready.
2. `registry.getSession(id)`:
   - `null` → CLI `session_not_found` error.
   - already-ended (`endedAt !== null`) → CLI
     `sessionAlreadyEndedMessage(id, existing.endedAt)` — exit 1
     before any mutation attempt. (Core would also throw on the
     call; this avoids the wasted lock acquisition for a known
     bad case.)
3. `registry.endSession(id, { endedAt: now() })`.
4. If Core throws `session_already_ended` here (race with another
   process between step 2 and 3), CLI does a second `getSession`
   to fetch the now-set `endedAt` and formats the same
   `sessionAlreadyEndedMessage`. If Core throws `session_not_found`
   here (impossible without external store mutation but covered
   for completeness), surface the standard `session_not_found`
   message.
5. `stdout(<sessionId>)` on success. Exit 0.

## §5 Errors

| Path                              | Source code           | CLI text                                                                  |
|-----------------------------------|-----------------------|---------------------------------------------------------------------------|
| name validation fail              | `nameSchema.parse`    | `error: name must not contain control characters` (existing reuse)        |
| invalid agent                     | `agentIdSchema.parse` | `error: invalid agent "<value>", expected: claude-code \| codex \| generic-cli` |
| invalid risk                      | `riskLevelSchema`     | `error: invalid risk "<value>", expected: low \| medium \| high \| critical`    |
| invalid title (empty after trim)  | `titleSchema`         | `error: title must not be empty`                                          |
| project not found                 | resolver inline       | `error: project "<name>" not found`                                       |
| session id not a UUID             | `sessionIdSchema`     | `error: invalid session id "<value>"`                                     |
| session not found (`get`/`end`)   | `session_not_found`   | `error: session "<id>" not found`                                         |
| session already ended             | `session_already_ended` (CLI pre-check) | `error: session "<id>" already ended at <endedAt>`              |
| store I/O                         | `CorePersistenceError`| existing funnel                                                           |

All paths exit 1.

## §6 Tests

Vitest, parity with `apps/cli/test/project.test.ts` and
`packages/core/test/json-directory-registry-*.test.ts`.

### Core (`packages/core/test/`)

- `session.test.ts` — already exists, schema-only.
- New file
  `packages/core/test/json-directory-registry-end-session.test.ts`
  (parity with the existing
  `json-directory-registry-failure-modes.test.ts` /
  `json-directory-registry-normalization.test.ts` split):
  - happy path: end an open session → `endedAt` set, persisted,
    re-read returns same value.
  - `session_not_found` on unknown id.
  - `session_already_ended` on second call.
  - in-memory parity: same three cases against
    `createInMemoryCoreRegistry()`.
- Lock test: extend
  `json-directory-registry-lock.test.ts` with one case that
  holds the lock and proves `endSession` waits / blocks the same
  way `createSession` does.

### CLI (`apps/cli/test/`)

- New `session.test.ts` covering:
  - `runSessionCreate` happy path (deterministic `newId` + `now`,
    asserts stdout = `<id>`, store contains the row).
  - missing project → `project "<name>" not found` stderr.
  - invalid agent → expected error text.
  - invalid risk → expected error text.
  - empty title (after trim) → expected error text.
  - default risk = `"medium"` when `--risk` omitted.
  - `--title` omitted → stored `null`.
  - `runSessionList` happy path (mixed sessions, empty title and
    set title both render correctly with `-` placeholder).
  - `runSessionList` empty project → empty stdout, exit 0.
  - `runSessionList` missing project → CLI error.
  - `runSessionShow` happy path (asserts each of the seven lines
    with column padding) plus a session with non-null `endedAt`
    rendering correctly.
  - `runSessionShow` not found → CLI error.
  - `runSessionEnd` happy path — `endedAt` written.
  - `runSessionEnd` already-ended → CLI message includes the
    existing `endedAt`.
  - NFC: `mega session create` with an NFD project name input
    resolves the NFC-stored project (same regression coverage
    as `apps/cli/test/project.test.ts` "I1" case).

### Smoke evidence

Manual via `node apps/cli/dist/cli.js` against `--store /tmp/<x>`:
create project, create session, list, show, end, show again. Two
runs covering all four subcommands, output captured into the PR
description.

## §7 Risk + non-goals

Risk **HIGH**. Triggers per CLAUDE.md §12:

- Worktree mandatory (we are in
  `.worktrees/cli-session-crud`).
- Architect pre-design pass — performed during this brainstorming.
- Critic adversarial review pass before merge.
- `code-reviewer` agent pass before merge (separate context from
  author).
- Verifier evidence (`pnpm verify` green + smoke transcript)
  before merge.

Non-goals (already in §2):

- No `update` / `patch` semantics.
- No `--all` cross-project listing.
- No JSON output mode.
- No session start ergonomic shortcuts beyond what `create` covers.

## §8 Open questions / future work

These are deferred, not blockers:

- v0.2: `mega session update <id> --title <new>` once a real use
  case appears (only `endedAt` matters for v0.1).
- v0.2: `--json` flag pass over `project list/create`,
  `session list/show/create/end`, `doctor` — single PR, single
  contract.
- v0.2: `mega session list --all` (introduces `listAllSessions()`
  on `CoreRegistry`; cross-project view for the dashboard).
- v0.2: `mega session show --include-memory` once MemoryEntry
  CLI lands.
- v0.2: cascade semantics — what `mega project delete` does to
  open sessions. Not relevant until `project delete` exists.
- v0.2: structured exit codes (today everything is `1`; differentiate
  not-found from validation).
