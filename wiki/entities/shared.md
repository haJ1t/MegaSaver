---
title: '@megasaver/shared'
tags: [entity, package, contracts, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-shared-package-design.md
  - docs/superpowers/plans/2026-05-04-shared-package-plan.md
status: active
created: 2026-05-04
updated: 2026-05-04
---

# `@megasaver/shared`

The cross-cutting contracts package. Every other v0.1 package
(`core`, `cli`, `connectors/claude-code`, `connectors/generic-cli`)
imports the canonical types and Zod schemas from here.

## Scope

Contracts only — no runtime util, no constants, no agent-specific
knowledge. v0.1 surface:

- `RiskLevel` — `"low" | "medium" | "high" | "critical"` enum
  (source: `docs/conventions/risk-modes.md`).
- `AgentId` — closed enum of agents that ship a v0.1 connector
  (`claude-code`, `generic-cli`). New agents are added by their own
  connector spec.
- `ProjectId`, `SessionId`, `MemoryEntryId` — UUID strings branded
  for compile-time discrimination. `ProjectId` is not assignable to
  `SessionId` even though both are `string` at runtime.

## Authoring style

Schema-first via Zod. Types are derived with `z.infer<typeof X>` so
the runtime parser and the static type stay in lock-step.

Tests live in `packages/shared/test/` and combine three layers:
happy + sad case → property-based via `fast-check` → compile-time
brand discrimination via Vitest's `expectTypeOf`.

## Boundary rules

- Anything agent-specific belongs in `connectors/<agent>/`, not
  here ([[concepts/agent-agnostic-core]]).
- Entity schemas land with the feature that consumes them — they
  do not live in this package preemptively.

## Related

- [[decisions/bootstrap-matrix]] — locks the v0.1 MVP slice
  (Decision #3).
- [[concepts/agent-agnostic-core]] — why scope is contracts-only.
- [[syntheses/mega-saver-product]] — v0.1 package roster
  (`@megasaver/shared` + four siblings).
