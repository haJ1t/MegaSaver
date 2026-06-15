---
title: '@megasaver/cli'
tags: [entity, app, cli, v0.1]
sources:
  - docs/superpowers/specs/2026-05-05-cli-package-design.md
  - docs/superpowers/plans/2026-05-05-cli-package-plan.md
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
  - docs/superpowers/plans/2026-05-06-cli-project-crud-plan.md
  - docs/superpowers/specs/2026-05-10-aa4-wiki-cli-surfaces-design.md
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-12-phase9-connectors-design.md
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
status: published
created: 2026-05-05
updated: 2026-06-14
---

# `@megasaver/cli`

The `mega` command. Lives at `apps/cli/`. App, not library — no
public TypeScript export surface, only a bin entry. The `bin` field
in `apps/cli/package.json` maps `mega → ./dist/cli.js`.

## Current slice

### `mega doctor`

Three stateless checks (Node version ≥22, platform, cwd). Plain text
output, summary line, exit 0 on all-PASS, exit 1 on any FAIL.

### `mega project create <name> [--root <dir>]`

Creates a project in the store. `rootPath` defaults to `process.cwd()`
if `--root` omitted; otherwise `rootPath = path.resolve(args.root)`
(absolute, supports relative inputs like `--root .`). No existence
check at create time — downstream `assertProjectRoot` is the validation
gate (e.g., `mega connector sync` will surface invalid roots). Stamps
RFC 3339 `createdAt`/`updatedAt`. Prints `<id>  <name>` on success.
Rejects duplicate names with `error: project "<name>" already exists`
and exit 1.

### `mega project list`

Lists all projects as `<id>  <name>` lines, one per project.
Prints nothing (empty stdout) when the store is empty.

### `mega session create <projectName> --agent <id> [--risk medium] [--title "..."]`

Creates a session against an existing project resolved by name.
`--agent` is required (`claude-code | codex | cursor | generic-cli`),
`--risk` defaults to `medium`, `--title` is optional and stored
as `null` when omitted. Output is the new session id on stdout.

### `mega session list <projectName>`

Lists sessions for a project as `<id>  <agent>  <risk>  <title|->`,
two spaces between fields. Empty project → empty stdout.

### `mega session show <sessionId>`

Prints seven aligned `key=value` lines (12-char key column,
two-space gutter): `id`, `project`, `agent`, `risk`, `title`,
`startedAt`, `endedAt`. `null` fields render as `-`.

### `mega session end <sessionId>`

Stamps `endedAt` on an open session. Idempotency rejected by
design: a second call surfaces `error: session "<id>" already
ended at <ts>` and exits 1.

### `mega session update <sessionId> [--title "..."] [--risk medium] [--agent <id>]`

Partial update of an open session. At least one of `--title`,
`--risk`, `--agent` is required; otherwise the command exits 1
with `error: nothing to update`. `--title ""` clears the title to
`null` (matches `session create` accept-empty semantics). Ended
sessions are rejected with `session_already_ended`. Silent stdout
on success, exit 0.

### `mega session saver {enable,disable,status,stats} <sessionId>` (BB2, AA1)

The Mega Saver Mode control surface over `Session.tokenSaver` (BB1).
Registered as the `saver` parent on the `session` subcommand tree.
All four take a positional `<session-id>` parsed through
`sessionIdSchema` and carry `--store <dir>` + `--json` parity.

- `enable <id> --mode safe|balanced|aggressive` — builds settings
  from `defaultTokenSaverSettings(now)` with `enabled: true`, the
  chosen `mode`, and `maxReturnedBytes: modeToBudget(mode)`, then
  persists via `CoreRegistry.updateTokenSaver`. `--mode` REQUIRED;
  invalid → `invalidModeMessage()` (derived from
  `tokenSaverModeSchema.options`, sibling of `invalidRiskMessage`).
  Text: `Mega Saver Mode enabled for <id> (<mode>; <bytes> B)`.
- `disable <id>` — rewrites the settings blob with `enabled: false`
  via `updateTokenSaver` (BB7a's `disableContextGate` orchestrator
  was not yet available, so disable mutates settings directly).
- `status <id>` — reports current `tokenSaver` state; renders an
  "enable" CTA when `session.tokenSaver === undefined` (pre-AA).
- `stats <id>` — settings line + real event totals from the stats
  store via core's `readSummary` re-export (stats-wiring-completion,
  2026-06-10). Text: `events: N | raw: … | returned: … | saved: … (P%)`
  + redaction/chunk counters; `No events recorded yet.` when empty.
  `--json` fills `eventStats` with `SessionTokenSaverStats | null`
  (BB6 stub retired; old "arrive with BB6" notice removed —
  intentional byte-compat break).

`--json` failure paths extended in
`apps/cli/test/json-failure-paths.test.ts`. Exit 0 success, 1 error.

### `mega memory create <projectName> --scope <project|session> --content "..." [--session <uuid>]`

Append a memory entry under a project. `--scope` is required and
must be `project` or `session`. `--content` is required, non-empty,
and rejects control characters / multi-line input. When
`--scope session`, `--session <uuid>` is required and must resolve
to an open or ended session under the same project; when
`--scope project`, `--session` is rejected. Output is the new
memory entry id on stdout.

### `mega memory list <projectName>`

Lists memory entries under a project as
`<id>  <scope>  <session|->  <content-truncated>` lines, two
spaces between fields. Content is truncated to 59 chars + `…` when
longer than 60. Empty project → empty stdout, exit 0.

### `mega memory show <memoryEntryId>`

Prints six aligned `key=value` lines (12-char key column,
two-space gutter): `id`, `project`, `session`, `scope`, `content`,
`createdAt`. `null` sessionId renders as `-`.

### `mega connector sync <projectName> [--target <id>]`

Writes the Mega Saver context block into each known agent file
under the project's `rootPath`. Known targets (7, Phase 9):
- `claude-code` → `CLAUDE.md`
- `codex` → `AGENTS.md`
- `cursor` → `.cursor/rules/megasaver.mdc` (frontmatter prepended on first seed)
- `aider` → `CONVENTIONS.md` (plain markdown, no frontmatter; user wires `aider --read CONVENTIONS.md`)
- `gemini` → `GEMINI.md` (Phase 9; flat-file, no header)
- `windsurf` → `.windsurfrules` (Phase 9; flat-file, no header)
- `continue` → `.continue/rules/megasaver.md` (Phase 9; flat-file, no header)

For each target the command reads the existing file, runs
`upsertBlock`, diff-checks against the existing content, and writes
only when the block changed. Files that do not yet exist are
silently `skipped` unless `--target <id>` opts in to seed exactly
that one. The session embedded in the block is the latest open
session whose `agentId` matches the target; `null` (`Session: none`)
when no match. Memory entries: project-scoped (always) plus session-scoped
entries belonging to the target's currently-picked open
session. Other agents' session-scoped memory is filtered out.

Status words on stdout: `wrote`, `noop`, `created`, `skipped`,
`error`. Best-effort partial failure: per-target errors emit on
stderr, the loop continues, exit 1 if any target failed.

### `mega connector status <projectName> [--target <id>]`

Read-only inspection of every known agent file under the project's
`rootPath`. Reuses the same `KNOWN_TARGETS` set as `sync` and the
same per-target latest-open-session rule. For each target the command
reads the file, runs `parseBlock`, and compares against the freshly
rendered block (`upsertBlock` predicate); the in-sync notion is
byte-identical to what `sync` would write.

Status words on stdout: `in-sync`, `drift`, `no-block`, `missing`,
`error`. Output line is `<id>  <relPath>  <status>  session=<id|none>`. Exit `0` when every line is `in-sync` or `missing`; exit
`1` if any line is `drift`, `no-block`, or `error`. Pre-loop failures
(project not found, unknown target, project root missing)
short-circuit before any line is emitted.

### `mega connector list <projectName> [--json]` (Phase 9)

Static enumeration of all known targets with present/absent for the
project's `rootPath`. For each target: reads whether the file exists
(no block parse). Always exits 0. Text line: padded id + agentId +
relativePath + `present`/`absent`. `--json` emits
`[{id, agent, relativePath, present}]`.

### `mega connector doctor <projectName> [--target <id>] [--json]` (Phase 9)

Per-target diagnostic. For each target reports one of six status words:
`ok` (file exists, block present, in-sync), `stale` (block out of date),
`no-block` (file exists but no sentinel block), `missing` (file absent,
benign), `not-writable` (no write permission; file or parent dir probed
with `access(W_OK)` — no write performed), `error`. Exit 1 on any
`stale`, `not-writable`, or `error`; exit 0 otherwise. `--json` emits
`[{id, relativePath, status, writable, session}]`.

### `mega output {file,filter,chunk}` (BB7a, AA1)

The Context Gate output surface. Routes raw tool output through the
redact → chunk → rank → fit → summarize pipeline and persists the raw
chunk set locally. New top-level `output` parent. `exec` (the only
spawning subcommand) is held for BB7b. `--store` + `--json` parity.

- `output file <id> --intent <s> <path>` — two-gate read safety then
  filter: `policy.evaluatePathRead` (secret-path denylist) →
  `outputFilter.resolveSafeReadPath` (sandbox) → `fs.readFile` →
  `outputFilter.filterOutput` → `contentStore.saveChunkSet`.
  Path-denial exits 1 with `path_denied: <reason>` (PolicyDenyCode);
  sandbox throw exits 1 with `path_unsafe: <message>` (output-filter
  error, structural not policy). Prints the filtered summary +
  savings %.
- `output filter <id> --intent <s> --file <log-path>` — no-spawn
  variant over an existing log file (`pnpm test > log.txt && mega
  output filter ...`).
- `output chunk <chunk-set-id> <chunk-id>` — returns one stored chunk.
  No `--intent`; `locate-chunk-set.ts` resolves ownership via the
  embedded project/session path.
- `--intent` REQUIRED for `file` / `filter` → `intent_required`.

**Where the pipeline lives:** AA1 §2a/§8d proposed a shared
`packages/core/src/context-gate/` orchestrator. As shipped, BB7a
composes the pipeline CLI-side in
`apps/cli/src/commands/output/shared.ts` (`resolveEffectiveSettings`,
`runTwoGates`, `readAndFilter`, `persistChunkSet`) — no `context-gate/`
in core, no new core deps. Pre-AA sessions (no `tokenSaver`) get
read-only defaults (mode `balanced`). (Historical BB7a note: stats
events were not appended then; wiring completed on both paths
2026-06-10 — see [[entities/stats]].)
See [[concepts/context-gate-pipeline]].

### `mega pack {install,list,remove,info}` (skill-packs-real, 2026-06-10)

Skill-pack management over [[entities/skill-packs]]. All four take
`--root <dir>` (workspace root, default cwd — future skill runtime
keys off the registered `project.rootPath`) and `--json` (canonical
flag shape; failure = text stderr, exit 1, no stdout).

- `install <path> [--force]` — validate-before-copy, full-tree symlink
  rejection, shadow-aware skill-id conflict scan, atomic `.tmp-<name>`
  staging. Text: `Installed <name>@<version> (<kind>, N skills)`.
- `list` — discovery over workspace + global roots; per-pack line
  `name@version kind source`; discovery warnings → stderr (`--json`
  carries `{ packs, warnings }`).
- `remove <name>` — workspace-only; `pack_not_found` if absent.
- `info <name>` — workspace-beats-global resolution; renders manifest.

Errors surface as `error: <SkillPackErrorCode>: <detail>` via
`skillPackErrorMessage` (closed 7-member enum, [[entities/skill-packs]]).

### `mega hooks {install,status}` (Proxy Mode v1.2, P5)

Hook telemetry surface for measuring native-tool interception. Shipped
P5 (commit `07040de`). See [[concepts/proxy-mode]].

- `hooks install claude-code` — idempotent install of BOTH a Claude Code
  PreToolUse telemetry hook (`mega hooks log`) AND a PostToolUse saver
  hook (`mega hooks saver`), matcher `Read|Bash|Grep|Glob|LS`.
  Re-running does not duplicate either entry.
- `hooks status` — reports whether the hook is installed.
- `hooks log` — the PreToolUse target: a metadata-only, best-effort
  logger that always exits 0 (never blocks the agent's tool call).
- `hooks saver` (2026-06-15) — the PostToolUse target: realizes Saver
  Mode. When Saver Mode is enabled for the workspace
  (`stats/<wk>/workspace-token-saver.json`) and the tool output exceeds
  the mode budget, it evidence-preservingly compresses the output via
  `recordAndFilterOverlayOutput` (full redacted output stored as a
  recoverable chunk), records the per-session overlay event (→ live GUI
  Token saver tab), and returns `updatedToolOutput` so the model ingests
  the compressed result. Always exits 0; any error / multi-modal output
  ⇒ original untouched (passthrough).

### Store resolution

Default store: `$XDG_DATA_HOME/megasaver` (fallback
`~/.local/share/megasaver`). macOS and Linux only in v0.1;
Windows deferred. `--store <dir>` is declared on each `project`
subcommand; it appears after the subcommand chain, e.g.
`mega project list --store /tmp/x`.

On first use against an uninitialized directory the CLI calls
`initStore` (from `@megasaver/core`) which creates `rootDir`,
`projects.json`, and `sessions.json` without overwriting existing
files. A one-time notice is printed to stderr:
`note: initialized store at <path>`.

### Error handling

Every typed core error is caught and funneled to a single exit 1
path (`errors.ts`). No typed error is silently swallowed.

## Dev invocation

`pnpm exec mega` does NOT resolve at the workspace root. pnpm v9 only
symlinks a workspace package's bin when another package depends on it.
Canonical dev loop:

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/cli.js project list --store /tmp/demo-store
```

## Boundary rules

- No public library export; `private: true`.
- The CLI imports `@megasaver/core` for store and registry operations.
- `doctor` remains stateless; no store interaction.
- Pure functions accept injected parameters so tests avoid mocking
  `process` globals.

## Closed-set surface derivation

The following closed enums / sets have ALL their CLI surfaces
(error messages and `--help` descriptions) derived from the source
schema. Adding a member to the source auto-updates every surface
without manual mirroring.

| Closed enum / set | Source | Derived surfaces |
|---|---|---|
| `agentIdSchema` | `@megasaver/shared` | `invalidAgentMessage` error text (PR #22); `--agent` description on `session create` / `session update` (PR #23) |
| `riskLevelSchema` | `@megasaver/shared` | `invalidRiskMessage` error text (PR #22); `--risk` description on `session create` / `session update` (PR #23) |
| `memoryScopeSchema` | `@megasaver/core` | `invalidScopeMessage` error text (PR #22); `--scope` description on `memory create` (PR #23) |
| `KNOWN_TARGETS` (registry) | `apps/cli/src/known-targets.ts` | `invalidTargetMessage` error text (PR #22); `--target` description on `connector sync` / `connector status` (PR #25) |
| `tokenSaverModeSchema` | `@megasaver/shared` | `invalidModeMessage` error text; `--mode` description on `session saver enable` (BB2, PR #68) |

The "Keep in sync with X in Y" comments that previously annotated
these sites were removed across PRs #22, #23, and #25.

**Drift-guard test layers:**

1. **Description surfaces** (`--agent`, `--risk`, `--scope`, `--target`) — pinned
   with `toBe` against the exact derived format string (catches both member drift
   AND format drift). Introduced PR #23; extended to `KNOWN_TARGET_IDS` in PR #25.
2. **Error-message surfaces** (`invalidAgentMessage`, `invalidRiskMessage`,
   `invalidScopeMessage`) — asserted with `toContain` over `<schema>.options`
   (catches member drift only). Introduced PR #22.

## Risk

Risk HIGH (`docs/superpowers/specs/2026-05-06-cli-project-crud-design.md`).
Full superpowers chain applied; code-reviewer and critic passes
required before merge.

Session CRUD: PR <https://github.com/haJ1t/MegaSaver/pull/11> (`9c5a388`).
Connector sync: PR <https://github.com/haJ1t/MegaSaver/pull/14> (`204f922`).
Connector status: PR <https://github.com/haJ1t/MegaSaver/pull/15> (`b1a81cc`).
Connector status S1+S2 followups: PR <https://github.com/haJ1t/MegaSaver/pull/16> (`eb21060`).
Cursor connector target: PR <https://github.com/haJ1t/MegaSaver/pull/17> (`f2d7f63`).
Session update + I5 split: PR <https://github.com/haJ1t/MegaSaver/pull/18> (`04987a8`).
MemoryEntry CLI: PR <https://github.com/haJ1t/MegaSaver/pull/19> (`7a199b6`).
Connector memoryEntries wiring: PR <https://github.com/haJ1t/MegaSaver/pull/20> (`b0e4382`).
Aider connector target: PR <https://github.com/haJ1t/MegaSaver/pull/21> (`184b13d`).
Closed-enum tripwire refactor: PR <https://github.com/haJ1t/MegaSaver/pull/22> (`489f7d0`).
Citty description derive (Z1): PR <https://github.com/haJ1t/MegaSaver/pull/23> (`4722a3a`).
Y3 docs drift fix (4 agent files): PR <https://github.com/haJ1t/MegaSaver/pull/24> (`f0135f7`).
AA2 connector --target description derive: PR <https://github.com/haJ1t/MegaSaver/pull/25> (`a8fb044`).
Project create --root flag: PR <https://github.com/haJ1t/MegaSaver/pull/26> (`b20c9b6`).
BB2 `mega session saver` (AA1): PR <https://github.com/haJ1t/MegaSaver/pull/68> (`4660d37`).
BB7a `mega output {file,filter,chunk}` (AA1): PR <https://github.com/haJ1t/MegaSaver/pull/73> (`67d66dc`).

## JSON output policy

All 10 `--json` commands share a single consistent contract.

### Citty arg declaration

Every command declares the flag identically:

```ts
json: { type: "boolean", default: false, description: "Emit JSON output." }
```

### Consumption form

Inside every `run({ args })` handler the value is forwarded as:

```ts
json: !!args.json
```

### Commands covered

`project list`, `project create`, `session create`, `session end`,
`session update`, `memory create`, `memory list`, `memory show`,
`connector status`, `connector sync`.

### Success path

On success, one JSON value is emitted to stdout (an object or array
depending on the command). No text is written to stdout.

### Failure-path policy

On any failure path (pre-loop error, validation failure, store error):

- Text error message → **stderr only** (plain text, not a JSON envelope).
- **Nothing** → stdout.
- Exit code → **1**.

This means callers can always distinguish success (`stdout` has JSON,
exit 0) from failure (`stderr` has text, exit 1) without parsing stderr.

### Test enforcement

- **12 failure-path tests** in `apps/cli/test/json-failure-paths.test.ts`
  assert text-only stderr + empty stdout + exit 1 for each command.
- **Drift guards** in `apps/cli/test/project/list.test.ts`
  `describe.each` pin all 10 commands: `type: "boolean"`, `default: false`,
  `description: "Emit JSON output."`.

## AA1 / Mega Saver Mode

New CLI surfaces shipped by the AA1 epic (source: AA1 §1):

- `mega session saver {enable,disable,status,stats}` over
  `updateTokenSaver` (BB2). `enable` takes a positional `sessionId` +
  `--mode`; `--json` returns `{ sessionId, tokenSaver }`.
- `mega output {file,filter,chunk,exec}` (BB7a/BB7b). `exec` spawns a
  policy-gated child (`-- <cmd>`); the command is matched against the
  allow-list by EXACT string. `--json` returns
  `{ sessionId, result: { …, savingRatio, chunkSetId } }`.
- `mega mcp {install,repair,status,uninstall}` (BB8). `mcp status
  --json` is an `agentId`-keyed array; the CLI reports the install bit
  (connectorSynced resolves only on the GUI doctor path). `mcp repair`
  requires `--target` + `--project` (install + connector sync, §5c).

## ContextOps command groups — Phases 2, 3, 5–8 (2026-06-12)

Each group is registered in `apps/cli/src/main.ts` `subCommands` and
backed by the engine of its phase. All support `--json`.

- **`mega scan <project>`** + **`mega index {build,status,search,show}`**
  (Phase 2) — list indexable files, parse the repo into typed
  `CodeBlock`s, and query the index. See [[concepts/semantic-repo-index]],
  [[entities/indexer]].
- **`mega context {build,explain,audit,export}`** (Phase 3) — build a
  task-aware context pack (`--task`, optional `--failing-test` /
  `--changed-file`), explain per-block / per-factor scores, audit the
  token savings, export. See [[concepts/context-pruning-engine]],
  [[entities/context-pruner]].
- **`mega fail {record,list,show}`**, **`mega rules {list,add,apply}`**,
  and **`mega learn from-failure`** (Phase 5) — record failed attempts,
  manage and rank reusable project rules, convert a failure into a rule.
  See [[concepts/failed-run-learning]].
- **`mega task {plan,status,step,retry,explain}`** (Phase 6) — author a
  typed, dependency-aware plan; report a step running/completed/failed;
  retry resets only the failed step + its dependents. See
  [[concepts/task-engine]].
- **`mega tools {add,list,route,explain}`** (Phase 7) — register
  `ToolDefinition`s and route a task-relevant, danger-gated subset
  (`{allowedTools, blockedTools, reason}`). See [[concepts/tool-router]].
- **`mega audit {report,last,session,export}`** (Phase 8) — the
  token-savings dashboard, windowed `session | week | all`. See
  [[concepts/audit-dashboard]], [[entities/stats]].

## Phase 10 — Team/Cloud (local slice, 2026-06-12)

### `mega memory approve <memoryEntryId> [--json] [--store <dir>]`
### `mega memory reject <memoryEntryId> [--json] [--store <dir>]`

Set `approval` on a memory entry. Idempotent (re-approving an already-approved
entry exits 0). Missing id → `memoryEntryNotFoundMessage` + exit 1. `--json`
emits the full updated `MemoryEntry`.

### `mega memory search … [--all]` (extended, Phase 10)

New `--all` flag passes `includeUnapproved: true` to `searchMemoryEntries` so
humans can review pending suggestions. Without `--all`, only `approved` entries
are returned (gate point 1).

### `mega memory list` / `mega memory explain` (extended, Phase 10)

`formatMemoryListLine` gains an `approval` column (9-char padded, after
`session`). `formatMemoryExplainLines` gains an `approval: <value>` row after
`source`.

### `mega github pr-comment <projectName> [--task <s>] [--post <n>] [--json]` (Phase 10)

Print a PR comment built from **approved** project memory relevant to `--task`.
Uses gate point 1 (`searchMemoryEntries`, scope=project, `includeUnapproved`
default false) — only approved memory surfaces. `--post <n>` spawns
`gh pr comment <n> --body-file -` (off-by-default, untested-by-design `gh`
wrapper; missing/non-zero `gh` → exit 1). Print-only path is unit-tested.

`mega github` is the new top-level group (`apps/cli/src/commands/github/`).

### connector sync — approval gate (Phase 10)

`filterMemoryEntriesForSession` (in `apps/cli/src/commands/connector/shared.ts`)
now pre-filters `entry.approval !== "approved"` before scope/session checks.
Only approved memory flows into agent config files. GUI mirror
(`apps/gui/bridge/connector-context.ts`) carries the same filter.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/core]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
