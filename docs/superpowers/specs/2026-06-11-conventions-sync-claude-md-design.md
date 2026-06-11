---
title: conventions:sync → CLAUDE.md (full reconciliation)
status: design
risk: high
date: 2026-06-11
author: halit
supersedes-gap: post-v1.1-roadmap #2
parent-spec: docs/superpowers/specs/2026-05-10-jj-conventions-sync-design.md
---

# conventions:sync → CLAUDE.md (full reconciliation)

## Mission

Close roadmap #2. `pnpm conventions:sync` manages `AGENTS.md` + 3
`.cursor/rules/*.mdc` only; **`CLAUDE.md` is hand-maintained and has
drifted from `docs/conventions/*.md`**. Make `CLAUDE.md` a managed
consumer so `conventions:check` (already in `pnpm verify`) guards it.

## Why this is HIGH risk, not "cosmetic" (discovery 2026-06-11)

A first design assumed CLAUDE.md sections were a cosmetic reformat of
the sources. **Measurement disproved it.** Per-section semantic
similarity (markers stripped, whitespace collapsed) of CLAUDE.md §N vs
`docs/conventions/<src>.md`:

| § | sim | who leads |
|---|-----|-----------|
| §2 repo-layout | 1.00 | equal |
| §1 mission | 0.96 | equal (cosmetic) |
| §3 stack | 0.87 | source (has "aspirational" note) |
| §7 dogfood | 0.75 | source (cursor-frontmatter contract) |
| §4 process | 0.72 | source (TDD/spec-path detail) |
| §9 DoD | 0.66 | source (evidence rules) |
| §6 agent-routing | 0.64 | mixed |
| §13 anti-patterns | 0.52 | mixed |
| §5 skill-routing | 0.52 | CLAUDE (§5a–d, OMC, design tables) |
| §11 language | 0.50 | mixed |
| §10 git | 0.46 | source (commit-format detail) |
| §8 code-conv | 0.38 | source (full tsconfig flags) |
| §12 risk-modes | 0.35 | source (examples) |

Divergence is **bidirectional** — neither side uniformly leads — and
`AGENTS.md` (already synced from sources) therefore disagrees with
`CLAUDE.md` today. Closing #2 = a content reconciliation across the 13
shared governance sources, which also rewrites the `AGENTS.md`/`.mdc`
outputs. Touches every agent's governance file → `risk: high`
(per §12: public surface / user files at scale).

## Reconciliation method — 3-way classification per section

For each section, every normative claim from CLAUDE.md §N AND from
`docs/conventions/<src>.md` is sorted into exactly one bucket:

1. **Shared (agent-neutral):** belongs to all agents → goes into the
   canonical `docs/conventions/<src>.md` (superset of both sides,
   deduped, agent-neutral phrasing: `## H2` sub-headings, no "this
   file", no Claude-only tool names). Propagates to every consumer.
2. **Agent-specific:** meaningful only to one agent (e.g. CLAUDE
   §5c OMC skills/agent roster, §5a–d numbering, §6 specific agent
   names, "Right pane: Claude Code"). **Stays in that agent file's
   hand-zone OUTSIDE the sentinel block.** MUST NOT enter a shared
   source, or Codex/Cursor would inherit Claude-only rules.
3. **Conflict (not mergeable):** the two sides state different rules
   for the same thing. Flagged in the plan for human decision; never
   silently picked.

The canonical source, after merge, is the verbatim body of the block
in every consumer. The `## §N Title` heading and trailing `Source:`
link stay outside the block (hand-kept, preserved by the engine).

## §0 Wiki-First (decision B1)

`§0` has no source. Create `docs/conventions/wiki-first.md` from the
current §0 body, **rephrased agent-neutral** (drop "right pane: Claude
Code"; the side-by-side tmux/MCP-bridge specifics are Claude-specific →
they stay in the CLAUDE.md/AGENTS.md hand-zone, not the source). Add a
`wiki-first` block to `CLAUDE.md` and `AGENTS.md`.

## Engine facts that shape the work (verified)

- `sync` **replaces existing sentinel blocks only — it does not insert
  missing ones** (`syncOne` errors `block-malformed` if a declared
  block is absent). So CLAUDE.md must be hand-bootstrapped with all 14
  sentinel pairs present; `--write` then fills them from source.
- `render.ts`/`parse.ts`/`diff.ts`/`sync.ts`/`cli.ts` are unchanged —
  the new consumer is pure manifest data; the engine already loops N
  consumers.
- The feature worktree has **no `node_modules`** — `pnpm install` in
  the worktree before running `conventions:*`.

## Block mapping (`claude-md` consumer, document order)

`wiki-first`(§0)→`wiki-first.md`; then §1–§13 →
`mission, repo-layout, stack-and-commands, process-discipline,
skill-routing, agent-routing, multi-agent-dogfood, code-conventions,
definition-of-done, git-and-commits, language, risk-modes,
anti-patterns` (14 blocks).

## Components touched

- `docs/conventions/wiki-first.md` — NEW canonical source.
- `docs/conventions/*.md` (13) — enriched to the reconciled superset
  where CLAUDE led (§5, §6, §11, §13 …). Where source already led, no
  change.
- `scripts/conventions-sync/src/manifest.ts` — add `claude-md`
  consumer; `manifest.test-d.ts` pins updated.
- `CLAUDE.md` — bootstrap sentinels around §0–§13; agent-specific
  content kept outside blocks; `## §N` headings + `Source:` links kept.
- `AGENTS.md`, `.cursor/rules/*.mdc` — re-`--write` so their blocks
  reflect the enriched sources (their content changes follow from the
  shared merge; this is expected and desired — it closes the existing
  AGENTS↔CLAUDE disagreement).

## Testing

Mechanism (TDD, in `scripts/conventions-sync/test/`):
- `manifest.test.ts` — `claude-md` consumer present, 14 blocks, correct
  source + document order.
- `sync.test.ts` — round-trip: after `--write`, `--check` clean on
  `CLAUDE.md`; mutating one block body → `--check` non-zero with a diff
  naming the block; missing block → `block-malformed` error.
- `parse.test.ts` — content outside blocks (`## §N`, `Source:`,
  agent-specific hand-zone) preserved verbatim.

Content-preservation gate (per-section, during reconciliation): a
verifier confirms **no normative claim from either input was dropped or
silently altered** — only re-bucketed (shared→source, agent-specific→
hand-zone). This is the HIGH-risk guard; it is adversarial, not a unit
test.

Acceptance: `pnpm conventions:test` green; `pnpm conventions:check`
green after one `--write`; `pnpm verify` green.

## Rollout

`risk: high`. Worktree-isolated (`feat/conventions-sync-claude-md`).
Architect design pass + critic review (per §12). The dirty-tree §0 on
`main` is superseded by the sourced version on merge;
`.cursorrules`/`.claude/`/`.dfmt/` out of scope.

## Out of scope

- No sync-engine internals change (insert-missing-block is a possible
  future ergonomic, not needed: bootstrap is one-time).
- No whole-file derivation (AGENTS.md stays a slim-subset mirror).
- No `CONVENTIONS.md` (aider dogfood); repo generates none.
- Conflict-bucket items, if any, are resolved by the user before
  `--write`, not invented here.
