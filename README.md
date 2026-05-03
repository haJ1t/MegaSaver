# Mega Saver

> ContextOps platform for frontier coding agents.

**Status:** v0.1 in development. No installable artifacts yet.

Mega Saver connects to Claude Code, Codex, Cursor, Aider, and any
CLI agent. It manages context, memory, sessions, and token
efficiency from one control panel. _Less tokens. More signal.
Same or better agent performance._

## Where to read

- [`CLAUDE.md`](CLAUDE.md) — project conventions and discipline (canonical for Claude Code).
- [`AGENTS.md`](AGENTS.md) — Codex governance.
- [`docs/conventions/`](docs/conventions) — single source of truth for all rules.
- [`docs/superpowers/specs/`](docs/superpowers/specs) — design specs.
- [`docs/superpowers/plans/`](docs/superpowers/plans) — implementation plans.

## Develop

Requirements: Node 22 LTS and pnpm 9.x (Corepack-managed).

```bash
corepack enable
pnpm install
pnpm verify   # lint + typecheck + test
```

## License

MIT — see [`LICENSE`](LICENSE).
