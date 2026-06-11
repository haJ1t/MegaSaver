---
title: conventions:sync → CLAUDE.md tagged blocks
status: design
risk: medium
date: 2026-06-11
author: halit
supersedes-gap: post-v1.1-roadmap #2
parent-spec: docs/superpowers/specs/2026-05-10-jj-conventions-sync-design.md
---

# conventions:sync → CLAUDE.md tagged blocks

## Mission

Close roadmap #2. Today `pnpm conventions:sync` manages `AGENTS.md` +
3 `.cursor/rules/*.mdc` only; **`CLAUDE.md` is hand-maintained**, so it
drifts. The live proof: a `§0 Wiki-First Memory` block was just hand-
pasted into both `CLAUDE.md` and `AGENTS.md` with no canonical source —
exactly the drift the sync system exists to kill.

Make `CLAUDE.md` a managed consumer so `conventions:check` (already
folded into `pnpm verify`) guards it in CI forever after.

## Design decisions (user-approved 2026-06-11)

1. **Mechanism: reuse the existing verbatim-block model. No new
   renderer.** `render.ts` copies a `docs/conventions/<src>.md` body
   verbatim between `<!-- conventions:start id=… source=… -->` /
   `<!-- conventions:end id=… -->` sentinels. The human `## §N Title`
   heading and trailing `Source:` link stay OUTSIDE the block (hand-
   maintained, preserved across syncs) — identical to how `AGENTS.md`
   works today.
2. **Scope: all of CLAUDE.md §0–§13 managed.** §1–§13 map to the 13
   existing `docs/conventions/*.md`; §0 maps to a NEW
   `docs/conventions/wiki-first.md` (decision B1).
3. **§0 Wiki-First → promoted to source (B1).** The hand-added §0
   content becomes `docs/conventions/wiki-first.md` (canonical), then
   regenerates as a sentinel block in BOTH `CLAUDE.md` and `AGENTS.md`.
   The manual edit is absorbed, not discarded.
4. **One-time cosmetic reformat of CLAUDE.md accepted.** The verbatim
   model emits the source's `## Tagline` H2 sub-headings rather than
   CLAUDE.md's current `**Tagline:**` inline-bold. Content is identical;
   only sub-heading style changes, matching `AGENTS.md`. No custom
   renderer = no byte-drift risk.

## Block mapping (`claude-md` consumer)

`CLAUDE.md` declares 14 blocks, in document order:

| § | id | source |
|---|----|--------|
| §0 | `wiki-first` | `wiki-first.md` *(new)* |
| §1 | `mission` | `mission.md` |
| §2 | `repo-layout` | `repo-layout.md` |
| §3 | `stack-and-commands` | `stack-and-commands.md` |
| §4 | `process-discipline` | `process-discipline.md` |
| §5 | `skill-routing` | `skill-routing.md` |
| §6 | `agent-routing` | `agent-routing.md` |
| §7 | `multi-agent-dogfood` | `multi-agent-dogfood.md` |
| §8 | `code-conventions` | `code-conventions.md` |
| §9 | `definition-of-done` | `definition-of-done.md` |
| §10 | `git-and-commits` | `git-and-commits.md` |
| §11 | `language` | `language.md` |
| §12 | `risk-modes` | `risk-modes.md` |
| §13 | `anti-patterns` | `anti-patterns.md` |

(Block ids reuse the parent spec's vocabulary; same ids already exist
in `AGENTS.md`/`.mdc` consumers — ids are per-consumer, so reuse is
fine.)

## Components touched

- `scripts/conventions-sync/src/manifest.ts` — add the `claude-md`
  `ConsumerSpec` to `CONSUMERS` (document-order block list above).
  `manifest.test-d.ts` order/pin assertions updated.
- `docs/conventions/wiki-first.md` — NEW canonical source, authored
  from the current §0 body (strip CLAUDE-specific phrasing that names
  "this file"; keep agent-neutral, as the other sources are).
- `CLAUDE.md` — convert §0–§13 bodies to sentinel-wrapped verbatim
  blocks; keep `## §N` headings + `Source:` links outside blocks.
- `AGENTS.md` — add the `wiki-first` block (it already carries the
  other shared blocks). Its existing manual §0 is replaced by the
  generated block.

No change to `parse.ts`, `render.ts`, `diff.ts`, `sync.ts`, `cli.ts` —
the consumer is pure data; the engine already handles N consumers.

## Pre-existing content reconciliation

`CLAUDE.md` §1–§13 must, after first `--write`, be byte-equal to the
rendered source. Where the current hand-text diverges from
`docs/conventions/*.md` beyond sub-heading style (e.g. extra sentences
in CLAUDE that are absent from the source), the spec rule is: **the
canonical source wins**; if a CLAUDE-only sentence is worth keeping, it
is added to the `docs/conventions/` source first (so all consumers get
it), never left as a CLAUDE-only island. The plan phase enumerates each
section's diff and routes every divergence to one of: (a) already
equal, (b) cosmetic (sub-heading) — absorbed, (c) CLAUDE-only content —
lift into source. No silent drops.

## Testing (TDD)

New cases in `scripts/conventions-sync/test/`:

- `manifest.test.ts` — `claude-md` consumer present; 14 blocks; correct
  source per block; document order.
- `sync.test.ts` — round-trip: `--write` then `--check` on `CLAUDE.md`
  is clean; mutating one block body → `--check` exits non-zero with a
  diff naming the block.
- `parse.test.ts` — §0 `wiki-first` block parses; content outside
  blocks (`## §N` headings, `Source:` links) preserved verbatim.
- A `wiki-first.md` source-exists + non-empty assertion.

`pnpm conventions:test` green; `pnpm conventions:check` green after the
one-time `--write`; `pnpm verify` green (check is already folded in).

## Risk & rollout

`risk: medium`. Mechanical + fully verifiable (content-identical,
diff-guarded). Worktree-isolated (`feat/conventions-sync-claude-md`).
The dirty-tree `§0` manual edit on `main` is superseded by the sourced
version on merge; `.cursorrules`/`.claude/`/`.dfmt/` are out of scope
and untouched.

## Out of scope

- No whole-file derivation (parent spec rejected it; AGENTS.md stays a
  slim mirror via its own subset).
- No `CONVENTIONS.md` (aider dogfood) — repo generates none; separate.
- No changes to the sync engine internals.
