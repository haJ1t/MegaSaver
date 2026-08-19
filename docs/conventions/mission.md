# Mission

Mega Saver is the ContextOps platform for frontier coding agents.
It connects to Claude Code, Codex, Cursor, Aider, and any CLI agent.
It manages context, memory, sessions, and token efficiency from one
control panel.

## Tagline

"Less tokens. More signal. Same or better agent performance."

## Non-negotiable principle

Mega Saver Core is agent-agnostic. Agents connect to Mega Saver,
never the reverse. Every connector is a thin adapter. Never let
agent-specific logic bleed into Core.

## First-party agent

Mega Saver also ships its own coding harness, `mega-agent`
(`crates/mega-agent`, Rust). This does not exempt it from the
principle above — it is the sharpest test of it. `mega-agent`
connects to Core through the daemon exactly as a third-party agent
does, over the same routes, with no privileged path and no
short-cut into Core internals. Nothing in Core may know that
`mega-agent` exists.

The harness earns its place by measurement, not by being ours: it
ships only while a two-arm eval shows a bare agent loop scoring
worse than the same model driven through the harness. If the delta
goes to zero, the harness is the thing that gets cut, not the
measurement.

Operator-confirmed 2026-08-19. Design:
`docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md`.

## What we are NOT

- Not a model proxy by default. An opt-in local proxy is permitted
  (`mega proxy`) for token metering and, later, conversation-context
  saving; it is never on unless the operator points an agent at it.
- Not an LLM-blinder. We preserve evidence; we never strip what
  the model needs to decide.
- Not a team chatops tool. Single-developer first.
