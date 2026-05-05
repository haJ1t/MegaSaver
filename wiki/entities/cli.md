---
title: '@megasaver/cli'
tags: [entity, app, cli, v0.1]
sources:
  - docs/superpowers/specs/2026-05-05-cli-package-design.md
  - docs/superpowers/plans/2026-05-05-cli-package-plan.md
status: published
created: 2026-05-05
updated: 2026-05-05
---

# `@megasaver/cli`

The `mega` command. Lives at `apps/cli/`. App, not library — no
public TypeScript export surface, only a bin entry. The `bin` field
in `apps/cli/package.json` maps `mega → ./dist/cli.js`.

## Current slice

The first CLI slice is scaffold only:

- `mega --version` — reads `apps/cli/package.json` via
  `createRequire`.
- `mega --help` — Citty default help with the `doctor` subcommand
  listed.
- `mega doctor` — three stateless checks (Node version ≥22, platform,
  cwd). Plain text output, summary line, exit 0 on all-PASS, exit 1
  on any FAIL.

The CLI does not import `@megasaver/core` or `@megasaver/shared` in
this slice. Real CRUD commands and registry consumption land in their
own specs once durable storage exists.

## Implementation status

Implementation is complete and external review passed.

## Implementation evidence

- `pnpm --filter @megasaver/cli test` passes: 1 test file, 17 tests.
- `pnpm --filter @megasaver/cli typecheck` passes.
- `pnpm --filter @megasaver/cli build` emits `dist/cli.js` with
  shebang `#!/usr/bin/env node` and a sourcemap; no `dist/cli.d.ts`.
- `pnpm verify` passes (lint + typecheck + test on all 3 packages).
- `node apps/cli/dist/cli.js doctor` prints `3 PASS / 0 FAIL` on
  Node 22+.

## Dev invocation

`pnpm exec mega` does NOT resolve at the workspace root. pnpm v9 only
symlinks a workspace package's bin when another package depends on
it; nothing depends on `@megasaver/cli` (it is the consumer). For dev
loops in v0.1 the canonical invocation is:

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/cli.js doctor
```

When the package is later published (post-v0.1, after dropping
`private: true` in its own spec), `pnpm install -g @megasaver/cli`
will create the global `mega` symlink via the standard npm bin field
contract. The bin field is correct today; only the workspace-local
symlink is missing by pnpm design.

## Boundary rules

- The CLI app has no public library export.
- The CLI app has `private: true` and is never published from v0.1.
- The CLI does not import `@megasaver/core` or `@megasaver/shared`
  in this slice — adding either is a follow-up spec decision.
- The `doctor` command must remain stateless until persistence lands
  in its own spec.
- Pure check functions (`checkNode`, `checkPlatform`, `checkCwd`)
  accept dependency-injected parameters so tests do not have to mock
  `process` globals.

## Risk

Risk MEDIUM (default per `docs/conventions/risk-modes.md`). This app
introduces the `mega` command name and the top-level CLI surface but
mutates no state, exposes no public library API, and touches no
durable storage. Full superpowers chain applies; `critic` is not
required at MEDIUM.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/core]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
