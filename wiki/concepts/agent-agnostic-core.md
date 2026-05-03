---
title: Agent-Agnostic Core
tags: [concept, foundation, architecture, non-negotiable]
sources: [raw/mega-saver-platform-fikri.txt]
status: active
created: 2026-05-03
updated: 2026-05-03
---

# Agent-Agnostic Core

The single most important architectural decision in Mega Saver. Cannot be relaxed.

## The principle

> Agents connect to Mega Saver. Mega Saver never connects to agents.

Every coding agent (Claude Code, Codex, Cursor, Aider, future ones) is a **thin connector** that translates between its own conventions and Mega Saver's neutral interfaces. The core engine never imports anything agent-specific.

## What this means in practice

- `@megasaver/core` has zero dependencies on Claude Code, Codex, Cursor SDKs, or any agent CLI.
- All agent-specific knowledge (CLAUDE.md format, AGENTS.md format, `.cursor/rules/*.mdc`, MCP message wire format) lives in `@megasaver/connectors/<agent>/`.
- The MCP bridge (deferred to v0.2) is a connector layer, not core.
- Skill packs that ship to agents are **generated** by connectors from neutral skill definitions in core.

## Why this matters

The product fikri (§3) names this as the make-or-break call:

> Wrong approach: build a Claude Code plugin.
> Right approach: build Mega Saver core. Claude Code is just a connector.

If an agent-specific assumption leaks into core, every other connector inherits it, and the platform becomes "Claude Code + adapters." The promise of one project memory shared across every agent dies.

## How to enforce

- **Code conventions §8** of [[sources/spec-bootstrap]]: "No agent-specific logic in `@megasaver/core`. Connectors isolate that."
- **Anti-pattern §13** of CLAUDE.md (will land in bootstrap PR): explicit hard rule.
- **Reviewer agent pass:** `code-reviewer` and `critic` flag any leak.
- **Package boundary:** core's `package.json` `dependencies` cannot include any agent SDK.

## What stays in core

- Token audit / context packing logic.
- Memory schema and storage primitives.
- Session registry, event log.
- Risk detector (rule-based, not agent-specific).
- Budget engine.
- Tool output compression algorithm (input is generic, not agent-shaped).
- File summary index.

## What stays in connectors

- How to start the agent.
- Where its config lives (`CLAUDE.md` vs `AGENTS.md` vs `.cursor/rules/*.mdc`).
- How to capture its tool outputs.
- How to inject context/prompt.
- How to render Mega Saver memory in the agent's expected format.
- The skill-pack template generator for that agent.

## Related

- [[concepts/contextops]]
- [[syntheses/mega-saver-product]]
- [[decisions/bootstrap-matrix]] decision #2 (monorepo) — chosen specifically to enforce this boundary structurally.
