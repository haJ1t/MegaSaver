---
title: Mega Saver — Product Synthesis
tags: [synthesis, foundation, product]
sources: [raw/mega-saver-platform-fikri.txt, docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md]
status: active
created: 2026-05-03
updated: 2026-05-03
---

# Mega Saver — Product Synthesis

Single-page answer to "what is Mega Saver?" Designed to replace re-reading the 1421-line `fikri.txt` for orientation.

## One-paragraph product description

Mega Saver is a [[concepts/contextops]] platform that connects to every frontier coding agent (Claude Code, Codex, Cursor, Aider, generic CLI) and gives the developer one control panel for context, memory, sessions, and token efficiency. A project's memory and rules are written once and shared across every agent — what Claude Code learns about your repo today, Codex inherits tomorrow.

## Tagline

> Less tokens. More signal. Same or better agent performance.

## The six subsystems

| Subsystem        | Role                                                                                                            | v0.1? |
|------------------|------------------------------------------------------------------------------------------------------------------|-------|
| **Core Engine**  | Token audit, context packer, memory vault, session registry, risk detector, budget engine. Agent-agnostic.       | YES   |
| **CLI** (`mega`) | The `mega` command. Project add, run, audit, session list, memory search, etc.                                    | YES   |
| **Connectors**   | Per-agent adapters. Translate between agent conventions (CLAUDE.md / AGENTS.md / `.cursor/rules`) and core.       | YES (Claude Code + generic CLI only); others later |
| **Skill Packs**  | Behavior overlays the platform ships INTO each agent (context-discipline, evidence-preservation, output-compression skills). | v0.2 |
| **MCP Bridge**   | MCP server that lets agents talk to core via tool calls (`mega.get_project_context`, `mega.compress_tool_output`, …). | v0.2 |
| **App / Dashboard** | Desktop or local web UI. Project + session + memory + audit + benchmark screens.                              | v0.3 |

The non-negotiable rule across all six: [[concepts/agent-agnostic-core]].

## v0.1 slice — what we are actually building first

Per [[decisions/bootstrap-matrix]] decision #3, the **headless-first** subset:

- `@megasaver/core` — the ContextOps engine
- `@megasaver/cli` — the `mega` command
- `@megasaver/connectors/claude-code` — first connector
- `@megasaver/connectors/generic-cli` — wrap-anything-CLI connector
- `@megasaver/shared` — types and Zod schemas

No GUI. No MCP bridge. No skill packs. No other connectors. Dogfood-able from day one.

## Feature backlog (top 30, from fikri §16)

Not built yet. Slot reserved. The first ~10 are: Token Audit, Repo Scanner, Ignore Generator, Instruction Optimizer, Context Packer, Evidence-Preserving Compression, Tool Output Compressor, Conversation Compactor, Memory Vault, Smart Retrieval. Each becomes its own brainstorm → spec → plan → implementation cycle per [[concepts/superpowers-discipline]].

## Strongest differentiator (fikri §17)

> Whichever frontier agent the developer uses, the same Mega Saver features and the same project memory work for it.

This converts the product from "yet another token saver" into an agent-bag ContextOps platform. It only works because of [[concepts/agent-agnostic-core]].

## What Mega Saver is NOT

- Not a model proxy.
- Not an LLM-blinder. Compression preserves evidence; never strips what the model needs to decide.
- Not a team chatops tool. Single-developer first.

## Bootstrap status (2026-05-03)

- Brainstorm spec ✓ committed (`docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md`).
- Implementation plan ✓ committed (`docs/superpowers/plans/2026-05-03-mega-saver-bootstrap-plan.md`).
- Wiki seeded ✓ this commit.
- Plan execution: pending — about to start (option 2 inline).

## Related

- [[concepts/contextops]]
- [[concepts/agent-agnostic-core]]
- [[concepts/risk-aware-development]]
- [[concepts/superpowers-discipline]]
- [[decisions/bootstrap-matrix]]
- [[sources/fikri-original]]
- [[sources/spec-bootstrap]]
- [[sources/plan-bootstrap]]
