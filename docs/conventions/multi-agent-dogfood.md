# Multi-Agent Dogfood

Mega Saver's product premise: connectors generate per-agent config.
We dogfood by writing all four agent files from day one and keeping
them in sync via a single source of truth.

## File scopes

- `CLAUDE.md` — full reference. Used by Claude Code.
- `AGENTS.md` — Codex format. Slim mirror.
- `.cursor/rules/*.mdc` — modular, auto-loaded by Cursor on globs.
- `CONVENTIONS.md` — plain markdown, written by
  `mega connector sync --target aider`. Loaded by Aider via
  `--read CONVENTIONS.md` or `.aider.conf.yml`.

## Drift prevention

1. Edit `docs/conventions/<file>.md` (single source).
2. Regenerate agent files via `pnpm conventions:sync` (deferred
   to v0.2; manual sync until then).
3. Commit convention + regenerated mirrors in same commit.
4. CI check (deferred): agent files must not contain content not
   present in `docs/conventions/`.

Until the sync script ships:

- `CLAUDE.md` is canonical.
- `AGENTS.md`, `.cursor/rules`, and `CONVENTIONS.md` updated MANUALLY
  when `CLAUDE.md` changes, in the same commit.
- PR diff review catches drift.
