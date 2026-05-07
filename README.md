# Mega Saver

> ContextOps platform for frontier coding agents.

Mega Saver gives coding agents a shared, durable context layer:
projects, sessions, memories, and connector-specific context files.
The product goal is simple: **Less tokens. More signal. Same or
better agent performance.**

**Status:** v0.1 is in active development. The repo is not published
to npm yet and should be treated as pre-release infrastructure.

## What exists now

Mega Saver is a TypeScript monorepo built with Node 22 LTS, pnpm
workspaces, Turborepo, tsup, Vitest, Biome, and Changesets.

Current packages:

- `@megasaver/shared` — shared contracts: branded IDs, `AgentId`, and
  `RiskLevel`.
- `@megasaver/core` — agent-agnostic engine: strict Zod schemas for
  `Project`, `Session`, and `MemoryEntry`; in-memory registry; JSON
  directory persistence; `initStore`; typed registry/persistence
  errors.
- `@megasaver/cli` — `mega` command with `doctor`, `project create`,
  and `project list`.
- `@megasaver/connector-claude-code` — thin Claude Code adapter that
  manages a Mega Saver block in root `CLAUDE.md`.

Current repository infrastructure:

- Strict ESM TypeScript workspace.
- `pnpm verify` gate: Biome lint, TypeScript project references, and
  Vitest.
- Superpowers specs/plans for each shipped slice.
- Wiki-first project memory under `wiki/`, used to reduce repeated
  repo reads and keep agent handoffs compact.

## Implemented slices

### Bootstrap and skeleton

The foundation is in place: monorepo layout, package conventions,
process governance, build/test/lint/typecheck scripts, and Changesets
release plumbing.

### Shared contracts

`@megasaver/shared` owns cross-package primitives:

- branded UUID IDs for projects, sessions, and memory entries
- `AgentId`
- `RiskLevel`

### Core engine

`@megasaver/core` is intentionally agent-agnostic. Connectors and the
CLI import Core; Core never imports connector or CLI code.

The current Core surface includes:

- `Project`, `Session`, and `MemoryEntry` schemas/types
- `createInMemoryCoreRegistry()`
- `createJsonDirectoryCoreRegistry({ rootDir })`
- `initStore(rootDir)`
- `CoreRegistryError`
- `CorePersistenceError`

The JSON directory store uses:

- `projects.json`
- `sessions.json`
- `memory/<projectId>.jsonl`

### CLI

The `mega` command currently supports:

```bash
mega doctor
mega project create <name> --store <dir>
mega project list --store <dir>
```

Default project storage is `$XDG_DATA_HOME/megasaver`, falling back to
`~/.local/share/megasaver`. On first use, the CLI initializes the
store with `initStore` and prints a one-line notice to stderr.

During local development, invoke the built CLI directly:

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/cli.js doctor
node apps/cli/dist/cli.js project create demo --store /tmp/megasaver-demo
node apps/cli/dist/cli.js project list --store /tmp/megasaver-demo
```

### Claude Code connector

`@megasaver/connector-claude-code` is the first connector slice. It
manages a single Mega Saver block inside root `CLAUDE.md`:

```md
<!-- MEGA SAVER:BEGIN -->
# Mega Saver Context

Agent: claude-code
Project: <name> (<id>)
Session: <title/id/none>
Risk: <risk/none>

## Memory

- [project:<entry-id>] <content>
- [session:<entry-id>] <content>
<!-- MEGA SAVER:END -->
```

The connector exposes validation, render/parse/upsert/remove helpers,
and filesystem helpers for root `CLAUDE.md` read/write/sync. It does
not launch Claude Code, touch `.claude/CLAUDE.md`, or perform memory
retrieval/compression yet.

## Not built yet

Planned v0.1 follow-up slices include:

- session CRUD in the CLI
- memory CRUD in the CLI
- generic CLI connector
- MCP bridge
- desktop/app control panel
- token audit and compression workflows
- package publishing

## Develop

Requirements:

- Node 22 LTS
- pnpm 9.x via Corepack

```bash
corepack enable
pnpm install
pnpm verify
```

Useful commands:

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm --filter @megasaver/<pkg> <cmd>
```

## Project memory and process

Start with the wiki when resuming work:

- [`wiki/index.md`](wiki/index.md) — current project memory index
- [`wiki/entities/core.md`](wiki/entities/core.md) — Core schemas,
  registry, errors, and persistence surface
- [`wiki/entities/cli.md`](wiki/entities/cli.md) — CLI commands and
  store behavior
- [`wiki/entities/connectors-claude-code.md`](wiki/entities/connectors-claude-code.md)
  — Claude Code connector contract

Authoritative process and conventions:

- [`AGENTS.md`](AGENTS.md) — Codex governance
- [`CLAUDE.md`](CLAUDE.md) — Claude Code governance
- [`docs/conventions/`](docs/conventions) — shared project rules
- [`docs/superpowers/specs/`](docs/superpowers/specs) — design specs
- [`docs/superpowers/plans/`](docs/superpowers/plans) —
  implementation plans

Every feature goes through spec, plan, TDD, verification, wiki update,
and external review before merge.

## License

MIT — see [`LICENSE`](LICENSE).
