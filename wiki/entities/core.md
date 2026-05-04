---
title: '@megasaver/core'
tags: [entity, package, core-engine, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/plans/2026-05-04-core-package-plan.md
status: plan-written
created: 2026-05-04
updated: 2026-05-04
---

# `@megasaver/core`

The agent-agnostic Core Engine package. Future v0.1 packages
(`cli`, `connectors/claude-code`, `connectors/generic-cli`) build on
this neutral package rather than importing each other.

## Current slice

The first core slice is foundation-only:

- `Project` schema.
- `Session` schema.
- `MemoryEntry` schema.
- Typed registry errors.
- `createInMemoryCoreRegistry()`.

Storage is intentionally in-memory only. Filesystem persistence,
memory search, token audit, context packing, and compression each need
their own spec.

## Plan status

Implementation plan written:
`docs/superpowers/plans/2026-05-04-core-package-plan.md`.

Execution has not started. The next gate is choosing
subagent-driven or inline execution, then strict TDD task-by-task.

## Boundary rules

- Core may depend on `@megasaver/shared`.
- Core may use `AgentId` as neutral data.
- Core must not know any agent config format such as `CLAUDE.md`,
  `AGENTS.md`, or `.cursor/rules/*.mdc`.
- Core must not start agents or shell commands.
- Core must not choose a durable storage format in this slice.

## Risk

Risk level is HIGH because this package defines the engine boundary
and public surface. Work happens in `feat/core-package`; external
review is required before merge.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
