---
title: Bootstrap Decisions Matrix
tags: [decision, bootstrap, foundation]
sources: [docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md]
status: locked
created: 2026-05-03
updated: 2026-05-03
---

# Bootstrap Decisions Matrix

Ten locked-in foundation decisions made during the bootstrap brainstorming on 2026-05-03. Cannot be changed without a new spec.

## Decisions

| # | Decision                | Locked-in value                                                                                         | Why                                                                                          |
|---|-------------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| 1 | Project root            | `/Users/halitozger/Desktop/MegaSaver/`                                                                  | Fresh dedicated dir. The Desktop `Saver/` placeholder left untouched (see open question).    |
| 2 | Repo shape              | Monorepo (`pnpm workspaces` + Turborepo)                                                                | Six independent deliverables; only clean way to enforce [[concepts/agent-agnostic-core]].    |
| 3 | First slice (MVP v0.1)  | **Headless-first**: Core Engine + CLI + Claude Code Connector + Generic CLI Connector                    | Dogfood-able immediately. GUI deferred to v0.3 — no design-skill overhead during foundation. |
| 4 | Stack                   | Node 22 LTS + TS strict ESM + pnpm + Turborepo + tsup + Vitest + Biome + Citty + Changesets             | Modern, ESM-native, monorepo-friendly. Single tool per slot.                                 |
| 5 | Process discipline      | **Strict** superpowers chain mandatory on every feature                                                  | Mega Saver itself preaches evidence/risk discipline; product-hypocrisy if dev process is lax.|
| 6 | Multi-agent dogfood     | Day-1: `CLAUDE.md` + `AGENTS.md` + `.cursor/rules/`                                                     | Maximum dogfood per user choice (option B in Q6).                                            |
| 7 | Design skill mapping    | `huashu-design` (concept) → `taste-skill` / `gpt-tasteskill` (impl) → `impeccable` (audit/polish)        | "design-taste-frontend" resolved to taste-skill OR gpt-tasteskill (context-dependent).       |
| 8 | Language                | All English (code, docs, commits, agent files). i18n deferred for product strings.                       | Global OSS trajectory; one source language.                                                   |
| 9 | Commits                 | Conventional Commits + `caveman-commit` skill style. Subject ≤50 chars. Body only when "why" non-obvious.| Terse + standard + auto-changelog-friendly.                                                  |
| 10| Git workflow            | Trunk-based + worktree-per-feature                                                                      | Aligns with [[concepts/superpowers-discipline]] hard gates.                                  |

## Anti-cheat clause

Per [[concepts/risk-aware-development]]: **risk level cannot be lowered to skip a skill.** Same applies here — these decisions cannot be reinterpreted to skip discipline.

## What this matrix does NOT cover

- GUI shell (Tauri vs Electron) — deferred to v0.3
- MCP bridge protocol shape — deferred to v0.2
- Direct Anthropic API usage policy — opt-in per feature spec
- GitHub remote — revisit at v0.1 finishing-branch
- `Saver/` directory fate — decided after bootstrap merge

## Source

Spec [[sources/spec-bootstrap]] §4 Decisions Matrix. Original brainstorming session 2026-05-03 captured in conversation; spec is authoritative.
