---
title: '@megasaver/cli'
tags: [entity, app, cli, v0.1]
sources:
  - docs/superpowers/specs/2026-05-05-cli-package-design.md
  - docs/superpowers/plans/2026-05-05-cli-package-plan.md
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
  - docs/superpowers/plans/2026-05-06-cli-project-crud-plan.md
status: published
created: 2026-05-05
updated: 2026-05-09
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
under the project's `rootPath`. v0.1 known targets:
- `claude-code` → `CLAUDE.md`
- `codex` → `AGENTS.md`
- `cursor` → `.cursor/rules/megasaver.mdc` (frontmatter prepended on first seed)
- `aider` → `CONVENTIONS.md` (plain markdown, no frontmatter; user wires `aider --read CONVENTIONS.md`)

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

| Closed enum / set | Source schema | Derived surfaces |
|---|---|---|
| `agentIdSchema` | `@megasaver/shared` | `invalidAgentMessage` error text (PR #22); `--agent` description on `session create` / `session update` (PR #23) |
| `riskLevelSchema` | `@megasaver/shared` | `invalidRiskMessage` error text (PR #22); `--risk` description on `session create` / `session update` (PR #23) |
| `memoryScopeSchema` | `@megasaver/shared` | `invalidScopeMessage` error text (PR #22); `--scope` description on `memory create` (PR #23) |
| `KNOWN_TARGETS` (registry) | `apps/cli/src/known-targets.ts` | `KNOWN_TARGET_IDS` derivation; `invalidTargetMessage` error text (PR #22); `--target` description on `connector sync` / `connector status` (PR #25) |

The "Keep in sync with X in Y" comments that previously annotated
these sites were removed across PRs #22, #23, and #25.

**Drift-guard test pattern:** each derived string is locked with a
`toBe` pinned-format assertion (not `toContain`) that catches both
member drift and format drift. Introduced in PR #23; extended to
`KNOWN_TARGET_IDS` in PR #25.

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

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/core]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
