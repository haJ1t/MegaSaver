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

## What we are NOT

- Not a model proxy by default. An opt-in local proxy is permitted
  (`mega proxy`) for token metering and, later, conversation-context
  saving; it is never on unless the operator points an agent at it.
- Not an LLM-blinder. We preserve evidence; we never strip what
  the model needs to decide.
- Not a team chatops tool. Single-developer first.
