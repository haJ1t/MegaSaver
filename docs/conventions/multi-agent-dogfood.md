# Multi-Agent Dogfood

Mega Saver's product premise: connectors generate per-agent config.
We dogfood by writing all four agent files from day one and keeping
them in sync via a single source of truth.

**Source of truth:** `docs/conventions/*.md` — fourteen canonical
files: `wiki-first.md` (§0) plus one per `CLAUDE.md` section §1–§13.
Every managed agent file mirrors named sections from them; nothing in
a managed block is hand-edited.

## File scopes

- `CLAUDE.md` — full reference. Used by Claude Code.
- `AGENTS.md` — Codex format. Slim mirror.
- `.cursor/rules/*.mdc` — modular, auto-loaded by Cursor on globs.
- `CONVENTIONS.md` — plain markdown, written by
  `mega connector sync --target aider`. Loaded by Aider via
  `--read CONVENTIONS.md` or `.aider.conf.yml`.

## Drift prevention

1. Edit `docs/conventions/<file>.md` (single source).
2. Regenerate agent files via `pnpm conventions:sync`.
3. Commit convention + regenerated mirrors in same commit.
4. `pnpm conventions:check` (folded into `pnpm verify`) fails CI if any
   managed file drifts from `docs/conventions/`.

`CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/*.mdc` are all managed
consumers: their sentinel-bounded blocks are regenerated from
`docs/conventions/`. Content **outside** the sentinel blocks (section
headings, `Source:` links, agent-specific notes) is hand-kept and
preserved across syncs. `CONVENTIONS.md` (Aider) is not a sync
consumer — the repo generates none; it is the product feature
`mega connector sync --target aider`.

## Cursor connector frontmatter contract

The cursor target writes `.cursor/rules/megasaver.mdc`. The
`ConnectorTarget.header` field contains YAML frontmatter that is
prepended exactly once — on the first seed of a non-existing file.
On every subsequent `mega connector sync`, only the content
**inside** the `MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END`
sentinel pair is touched. Any user edits to the frontmatter,
headings, or body text that live **outside** the sentinel block are
preserved across sync runs.
