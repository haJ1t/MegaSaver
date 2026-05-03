---
title: ContextOps
tags: [concept, foundation, product-category]
sources: [raw/mega-saver-platform-fikri.txt]
status: active
created: 2026-05-03
updated: 2026-05-03
---

# ContextOps

The product category Mega Saver invents.

## Definition

**ContextOps** is the operations layer for AI coding agents — managing context, memory, sessions, and token efficiency the way DevOps manages servers, deployments, and uptime.

A ContextOps platform sits between the developer and one or more frontier coding agents (Claude Code, Codex, Cursor, Aider, generic CLI). It owns:

- **Context** — what gets fed into the model's context window per turn.
- **Memory** — what persists across sessions (project/global/session scopes, with metadata).
- **Sessions** — the unit of work; recorded, replayable, analyzable.
- **Token economy** — measurement, budgets, audit, compression.
- **Skills / rules** — the behavioral overlays that make agents follow project discipline.

## Why it exists

Frontier coding agents are powerful but expensive on long sessions and large repos. The waste sources (per [[sources/fikri-original]] §2):

- Unnecessary file reads, full-file context.
- Repeated test/log outputs.
- Long terminal output.
- MCP / tool schema bloat.
- Long `AGENTS.md` / `CLAUDE.md` / rule files.
- Uncontrolled conversation history growth.
- Same info re-entering context every session.
- No project memory.
- Different agents working on the same project unaware of each other.
- Sessions never analyzed.
- Wrong compression for risky tasks.

Telling an agent "be brief" does not solve any of this. ContextOps does.

## Core principle

> Less tokens. More signal. Same or better agent performance.

## Three non-negotiables

1. **Evidence-preserving compression.** Compression must never strip what the model needs to make a decision. Summaries are not enough — exact source lines must be retrievable on demand.
2. **Agent-agnostic core.** See [[concepts/agent-agnostic-core]]. The platform is not a Claude Code plugin or a Codex extension — it's a system every agent connects to.
3. **Risk-aware modes.** See [[concepts/risk-aware-development]]. One compression mode does not fit all tasks; high-risk tasks turn aggressive compression OFF.

## Antipatterns

- Treating ContextOps as a model proxy. It is not.
- Treating it as an LLM-blinder that strips information. It must preserve evidence.
- Treating compression as the only goal. The goal is *signal-to-noise*; sometimes that means *more* tokens of the right kind.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/risk-aware-development]]
- [[syntheses/mega-saver-product]]
