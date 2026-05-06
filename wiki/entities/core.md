---
title: '@megasaver/core'
tags: [entity, package, core-engine, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/plans/2026-05-04-core-package-plan.md
  - docs/superpowers/specs/2026-05-05-core-persistence-design.md
  - docs/superpowers/plans/2026-05-05-core-persistence-plan.md
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
  - docs/superpowers/plans/2026-05-06-cli-project-crud-plan.md
status: persistence-merged
created: 2026-05-04
updated: 2026-05-06
---

# `@megasaver/core`

The agent-agnostic Core Engine package. Future v0.1 packages
(`cli`, `connectors/claude-code`, `connectors/generic-cli`) build on
this neutral package rather than importing each other.

## Public surface

- `Project`, `Session`, `MemoryEntry` schemas (Zod, strict).
- Typed registry errors.
- `createInMemoryCoreRegistry()` — deterministic in-memory registry.
- `createJsonDirectoryCoreRegistry(rootDir)` — durable JSON directory
  store: `projects.json`, `sessions.json`, `memory/<id>.jsonl`,
  temp-file plus rename writes, typed persistence errors.
- `initStore(rootDir)` — idempotent helper that creates `rootDir`,
  `projects.json`, and `sessions.json` (each `[]`) without overwriting
  existing files. Used by `@megasaver/cli` for first-run auto-init.

## Implementation status

Foundation, JSON directory persistence, and `initStore` are all
implemented and merged. Foundation + persistence: PR
<https://github.com/haJ1t/MegaSaver/pull/4> (merge commit `0656114`)
on `origin/main`. `initStore` + changeset: PR
<https://github.com/haJ1t/MegaSaver/pull/5> (merge commit `9003968`)
on `origin/main`.

## Evidence

- `pnpm --filter @megasaver/core test` passed: 89 tests, 10 files
  (foundation + persistence + initStore).
- `pnpm --filter @megasaver/core typecheck` passed.
- `pnpm --filter @megasaver/core build` passed.
- `pnpm verify` green (6/6 turbo tasks).

## Boundary rules

- Core may depend on `@megasaver/shared`.
- Core may use `AgentId` as neutral data.
- Core must not know any agent config format (`CLAUDE.md`, `AGENTS.md`,
  `.cursor/rules/*.mdc`).
- Core must not start agents or shell commands.
- Core persistence must remain a neutral storage implementation and
  must not infer CLI defaults or agent-specific file formats.

## Risk

Risk HIGH. Full superpowers chain applied; code-reviewer and critic
passes required per `docs/conventions/risk-modes.md`.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
