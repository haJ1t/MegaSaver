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
updated: 2026-05-08
---

# `@megasaver/cli`

The `mega` command. Lives at `apps/cli/`. App, not library — no
public TypeScript export surface, only a bin entry. The `bin` field
in `apps/cli/package.json` maps `mega → ./dist/cli.js`.

## Current slice

### `mega doctor`

Three stateless checks (Node version ≥22, platform, cwd). Plain text
output, summary line, exit 0 on all-PASS, exit 1 on any FAIL.

### `mega project create <name>`

Creates a project in the store. Sets `rootPath = process.cwd()` and
stamps RFC 3339 `createdAt`/`updatedAt`. Prints `<id>  <name>` on
success. Rejects duplicate names with `error: project "<name>"
already exists` and exit 1.

### `mega project list`

Lists all projects as `<id>  <name>` lines, one per project.
Prints nothing (empty stdout) when the store is empty.

### `mega session create <projectName> --agent <id> [--risk medium] [--title "..."]`

Creates a session against an existing project resolved by name.
`--agent` is required (`claude-code | codex | generic-cli`),
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

## Risk

Risk HIGH (`docs/superpowers/specs/2026-05-06-cli-project-crud-design.md`).
Full superpowers chain applied; code-reviewer and critic passes
required before merge.

Session CRUD: PR <https://github.com/haJ1t/MegaSaver/pull/11> (`9c5a388`).

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/core]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
