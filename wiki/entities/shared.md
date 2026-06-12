---
title: '@megasaver/shared'
tags: [entity, package, contracts, v0.1, phase9]
sources:
  - docs/superpowers/specs/2026-05-04-shared-package-design.md
  - docs/superpowers/plans/2026-05-04-shared-package-plan.md
  - docs/superpowers/specs/2026-06-12-phase9-connectors-design.md
status: active
created: 2026-05-04
updated: 2026-06-12
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
- `AgentId` — closed enum of agents that ship a connector (8 members,
  alphabetical): `aider`, `claude-code`, `codex`, `continue`, `cursor`,
  `gemini`, `generic-cli`, `windsurf`. Phase 9 (2026-06-12) widened from
  5 → 8 by adding `continue`, `gemini`, `windsurf`. New agents are added
  by their own connector spec.
- `ProjectId`, `SessionId`, `MemoryEntryId` — UUID strings branded
  for compile-time discrimination. `ProjectId` is not assignable to
  `SessionId` even though both are `string` at runtime.
- `titleSchema` / `Title` — Zod schema for session titles (NFC +
  C0/C1/DEL/U+2028/U+2029 ban). Canonical source; both CLI and the
  GUI bridge import from here. Added PP (#59), resolving code-reviewer
  M2 drift risk from PR #57.
- `tokenSaverModeSchema` / `TokenSaverMode` / `modeToBudget(mode)` —
  closed enum (`aggressive`, `balanced`, `safe`; AA3 alphabetic) +
  byte-budget map (4_000 / 12_000 / 32_000). Added BB1 of the AA1
  Context Gate epic. Hoisted here per AA1 §2e (F-CRIT-1) so neither
  the GUI bridge nor `@megasaver/output-filter` (BB5) need to import
  `@megasaver/core` for the mode enum. Pinned in
  `packages/shared/test/token-saver-mode.test-d.ts`.

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
