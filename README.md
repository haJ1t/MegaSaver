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
- `@megasaver/cli` — the `mega` command (see CLI Reference below).
- `@megasaver/connector-claude-code` — thin Claude Code adapter that
  manages a Mega Saver block in root `CLAUDE.md`.
- `@megasaver/connector-generic-cli` — manifest-driven connector for
  Codex, Cursor, and Aider targets.
- `@megasaver/connectors-shared` — agent-agnostic block helpers shared
  by all connectors.

Current repository infrastructure:

- Strict ESM TypeScript workspace.
- `pnpm verify` gate: Biome lint, TypeScript project references, and
  Vitest.
- Superpowers specs/plans for each shipped slice.
- Wiki-first project memory under `wiki/`, used to reduce repeated
  repo reads and keep agent handoffs compact.

## Connectors

v0.1 ships four built-in connector targets:

| Target | Agent file | Package |
|--------|-----------|---------|
| `claude-code` | `CLAUDE.md` (project root) | `@megasaver/connector-claude-code` |
| `codex` | `AGENTS.md` (project root) | `@megasaver/connector-generic-cli` |
| `cursor` | `.cursor/rules/megasaver.mdc` | `@megasaver/connector-generic-cli` |
| `aider` | `CONVENTIONS.md` (load via `aider --read CONVENTIONS.md`) | `@megasaver/connector-generic-cli` |

## CLI Reference

```bash
mega doctor

mega project create <name> [--root <dir>] [--json]
mega project list [--json]

mega session create <projectName> --agent <id> [--risk medium] [--title "..."]
mega session list <projectName>
mega session show <sessionId>
mega session end <sessionId>
mega session update <sessionId> [--title "..."] [--risk <level>] [--agent <id>]

mega memory create <projectName> --scope <project|session> --content "..." [--session <uuid>]
mega memory list <projectName> [--json]
mega memory show <memoryEntryId> [--json]

mega connector sync <projectName> [--target <id>]
mega connector status <projectName> [--target <id>] [--json]
```

All subcommands accept `--store <dir>` to override the default store
location (`$XDG_DATA_HOME/megasaver`, falling back to
`~/.local/share/megasaver`).

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
