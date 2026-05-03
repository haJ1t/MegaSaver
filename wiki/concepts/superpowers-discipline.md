---
title: Superpowers Discipline
tags: [concept, process, mandatory]
sources: [docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md, docs/conventions/process-discipline.md]
status: active
created: 2026-05-03
updated: 2026-05-03
---

# Superpowers Discipline

The mandatory development chain on every Mega Saver feature. No exceptions, no "this is too small for a spec."

## The mandatory chain (in order)

1. **`superpowers:brainstorming`** — idea → spec at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. **`superpowers:writing-plans`** — spec → step plan at `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.
3. **`superpowers:test-driven-development`** — failing test before any production code.
4. **`superpowers:verification-before-completion`** — run `pnpm verify` plus feature-specific evidence (CLI smoke / integration test / connector real-run capture). No "done" claim without evidence.
5. **`superpowers:requesting-code-review`** — pre-merge external reviewer agent pass. **Author and reviewer NEVER same active context.**

## Conditional skills

| Skill                                      | Trigger                                                       |
|--------------------------------------------|---------------------------------------------------------------|
| `superpowers:systematic-debugging`         | bug, test fail, unexpected behavior                           |
| `superpowers:using-git-worktrees`          | every feature default — start in isolated worktree            |
| `superpowers:dispatching-parallel-agents`  | 2+ independent tasks, no shared state                         |
| `superpowers:subagent-driven-development`  | plan with parallel-executable independent tasks               |
| `superpowers:receiving-code-review`        | review feedback received                                      |
| `superpowers:finishing-a-development-branch` | implementation complete, deciding merge / PR / cleanup       |

## Hard gates (no exceptions)

1. No implementation without an approved spec.
2. No merge without `pnpm verify` green (lint + typecheck + test).
3. No merge without external reviewer agent pass.
4. No "done" claim without verifier evidence.
5. **Author and reviewer NEVER the same active context.**

## Why this is mandatory

[[concepts/contextops]] preaches evidence-first discipline to the user. If the team building it skips brainstorming, plans, TDD, verification, or external review, the product is product-hypocrisy. Bootstrap [[decisions/bootstrap-matrix]] decision #5 explicitly chose **strict** over loose.

## Risk overlay

Levels in [[concepts/risk-aware-development]] modulate **which** skills are mandatory:

- LOW: optionally skip TDD when no logic.
- MEDIUM: full chain.
- HIGH: full chain + `architect` + `critic` + worktree.
- CRITICAL: HIGH + `tracer` + `security-reviewer` + manual confirmation. Forbids unsupervised loops.

## Where the rules live (canonical)

- `docs/conventions/process-discipline.md` — the source of truth.
- `CLAUDE.md` §4 — Claude Code mirror.
- `AGENTS.md` Process Discipline section — Codex mirror.
- `.cursor/rules/mega-discipline.mdc` — Cursor mirror.

## Related

- [[concepts/risk-aware-development]]
- [[decisions/bootstrap-matrix]]
- [[sources/spec-bootstrap]]
