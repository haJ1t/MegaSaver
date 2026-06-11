---
title: conventions-sync (dogfood drift tooling)
tags: [entity, tooling, dogfood, conventions, drift]
sources:
  - scripts/conventions-sync/src/manifest.ts
  - docs/superpowers/specs/2026-05-10-jj-conventions-sync-design.md
  - docs/superpowers/plans/2026-05-10-jj-conventions-sync.md
status: active
created: 2026-06-11
updated: 2026-06-11
---

# conventions-sync

Repo-internal script that keeps the per-agent rule files in sync with
a single source of truth, so the [[concepts/superpowers-discipline]]
dogfood (`CLAUDE.md §7`) does not drift by hand. Shipped PR #54
(`dff9575`) (source: index.md:214). NOT a workspace package — a script
under `scripts/conventions-sync/`, run via `node
--experimental-strip-types` (source: package.json:27).

## Commands

- `pnpm conventions:sync` — write mode; regenerate consumer files.
- `pnpm conventions:check` — `--check`; exit 1 on drift. Folded into
  `pnpm verify` so CI fails on un-synced files (source: index.md:219).
- `pnpm conventions:test` — vitest over `scripts/conventions-sync`.

Modes enum: `check | write | list` (source:
scripts/conventions-sync/src/manifest.ts:3).

## Source of truth

`docs/conventions/*.md` — 13 canonical files, one per `CLAUDE.md`
section §1–§13 (mission, repo-layout, stack-and-commands,
process-discipline, code-conventions, git-and-commits, language,
risk-modes, multi-agent-dogfood, anti-patterns, definition-of-done,
skill-routing, agent-routing).

## Consumers (managed files)

| Consumer id | Path | Blocks |
|---|---|---|
| `agents-md` | `AGENTS.md` | 8 |
| `cursor-context` | `.cursor/rules/mega-context.mdc` | 4 |
| `cursor-conventions` | `.cursor/rules/mega-conventions.mdc` | 4 |
| `cursor-discipline` | `.cursor/rules/mega-discipline.mdc` | 4 |

(source: scripts/conventions-sync/src/manifest.ts:25–72). Each block is
sentinel-bounded; user content outside a block is preserved (same
contract as `mega connector sync`, source: index.md:284).

## CLAUDE.md now managed (roadmap #2 — PR #112)

`CLAUDE.md` is now a managed consumer (14 blocks: §0 wiki-first +
§1–§13, placed first). Shipped by PR #112 (merged `c2ee52a`).
An adversarial per-section audit found `docs/conventions/*.md` were
already a content superset of CLAUDE.md for 11/13 sections; the two
gaps (`stack-and-commands.md` config filenames, `multi-agent-dogfood.md`
source-of-truth statement) were enriched. The hand-added `§0` was
promoted to a new agent-neutral source `wiki-first.md` and regenerated
into both `CLAUDE.md` and `AGENTS.md`. `conventions:check` (in
`pnpm verify`) now guards CLAUDE.md drift. There are now **fourteen**
sources (wiki-first + 13). (source: [[syntheses/post-v1.1-roadmap]] #2)

## Not to be confused with

`mega connector sync` is the **product** feature: it emits per-agent
files (incl. `aider` → `CONVENTIONS.md`) for a *user's* project, and
shipped separately (PR #21, #29). conventions-sync is the **repo's
own** dogfood tooling. The repo generates no root `CONVENTIONS.md`.

## Related

- [[concepts/superpowers-discipline]] · [[entities/connectors-shared]]
- [[syntheses/post-v1.1-roadmap]] · [[entities/cli]]
