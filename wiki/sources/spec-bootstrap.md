---
title: Spec — Bootstrap & Agent Governance
tags: [source, spec, bootstrap]
sources: [docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md]
status: approved
created: 2026-05-03
updated: 2026-05-03
---

# Spec — Bootstrap & Agent Governance

> Pointer page. Full spec: `docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md`. **Do not duplicate** the spec content here.

## Scope

Foundation-only:
1. Project bootstrap decisions (path, repo, stack, MVP, language, git workflow).
2. Agent governance files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`) and their canonical source `docs/conventions/`.

Subsystem architecture and feature implementation are explicitly **deferred** to subsequent specs.

## Risk

MEDIUM. Foundation choices propagate but no code, no production data, no user-facing changes.

## Status

Approved by user 2026-05-03. Locked in [[decisions/bootstrap-matrix]].

## Implementation

See [[sources/plan-bootstrap]] and the plan file at `docs/superpowers/plans/2026-05-03-mega-saver-bootstrap-plan.md`.

## What this spec covers (in order)

§1 Context · §2 Goals · §3 Non-goals · §4 Decisions Matrix · §5 CLAUDE.md content (13 §) · §6 AGENTS.md outline · §7 `.cursor/rules` outline · §8 `docs/conventions/` files (12) · §9 Open questions · §10 Risk · §11 Verification plan · §12 Next step

## Read the spec when…

- Drafting any of the 13 CLAUDE.md sections (verbatim content there)
- Drafting AGENTS.md or `.cursor/rules/*.mdc`
- Settling an open question (§9: Saver/, sync script, GUI shell, MCP, API usage, GitHub)
- Auditing whether a future change drifts from foundation discipline

## Open questions tracked in spec §9

1. `Saver/` directory fate — separate decision after bootstrap merges.
2. `pnpm conventions:sync` script — v0.2.
3. GUI shell (Tauri vs Electron) — v0.3 brainstorm.
4. MCP bridge protocol — v0.2 brainstorm.
5. Direct Anthropic API usage — opt-in per feature spec.
6. GitHub remote — revisit at v0.1 finishing-branch step.
