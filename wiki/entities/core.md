---
title: '@megasaver/core'
tags: [entity, package, core-engine, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/plans/2026-05-04-core-package-plan.md
  - docs/superpowers/specs/2026-05-05-core-persistence-design.md
  - docs/superpowers/plans/2026-05-05-core-persistence-plan.md
status: persistence-review-passed
created: 2026-05-04
updated: 2026-05-05
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

The next Core slice is JSON directory persistence:

- caller-provided `rootDir`;
- `projects.json` and `sessions.json`;
- `memory/<project-id>.jsonl`;
- typed persistence errors for invalid roots, I/O failures, corrupt
  JSON/JSONL, and invalid stored entities.
- public factory `createJsonDirectoryCoreRegistry()`.

## Implementation status

Implementation plan written:
`docs/superpowers/plans/2026-05-04-core-package-plan.md`.

Foundation implementation is complete, external review passed, and the
package is published on `origin/main`. Persistence spec and
implementation plan are approved; JSON directory persistence is
implemented in `feat/core-persistence` and external review passed.

## Foundation evidence

- `pnpm --filter @megasaver/core test` passed for the foundation
  slice.
- `pnpm --filter @megasaver/core typecheck` passed.
- `pnpm --filter @megasaver/core build` passed.
- `pnpm verify` passed on `main` after local merge.

## Persistence evidence

- Persistence implementation evidence before final re-review:
  `pnpm --filter @megasaver/core test` passed.
- Persistence implementation evidence before final re-review:
  `pnpm --filter @megasaver/core typecheck` passed.
- Persistence implementation evidence before final re-review:
  `pnpm --filter @megasaver/core build` passed.
- Public export smoke passed:
  `node --input-type=module -e "import { createJsonDirectoryCoreRegistry } from './packages/core/dist/index.js'; ..."`
  printed `0`; `.tmp-core-smoke` was removed.
- Final production code-reviewer re-check found no Critical,
  Important, or Minor issues and reported ready to merge.
- Final adversarial critic re-check found no Critical, Important, or
  Minor issues and reported ready to merge.

## Boundary rules

- Core may depend on `@megasaver/shared`.
- Core may use `AgentId` as neutral data.
- Core must not know any agent config format such as `CLAUDE.md`,
  `AGENTS.md`, or `.cursor/rules/*.mdc`.
- Core must not start agents or shell commands.
- Core persistence must remain a neutral storage implementation and
  must not infer CLI defaults or agent-specific file formats.

## Risk

Risk level is HIGH because this package defines the engine boundary
and public surface. Work happened in `feat/core-package`; both
code-reviewer and critic passes returned merge-ready after review
fixes. The feature branch was fast-forward merged into `main` and
pushed to GitHub.

The persistence slice is also HIGH because it chooses the first
durable storage format and writes user data under a caller-provided
store directory. It requires worktree isolation, strict TDD, full
verification, and separate code-reviewer plus critic passes.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
