---
title: DD3 — Z2/Z3 Type-Safety Plan
spec: docs/superpowers/specs/2026-05-10-dd3-z-typesafety-plan.md
risk: MEDIUM
created: 2026-05-10
---

# DD3 — Z2/Z3 Type-Safety Plan

## Goal

Wire vitest typecheck mode (Z2) so `expectTypeOf` assertions are
checked during `pnpm exec vitest run`, not only via `pnpm typecheck`.
Then add `.test-d.ts` regression suites (Z3) that pin the closed-enum
literal unions for `KnownTargetId`, `AgentId`, `RiskLevel`, and
`MemoryScope`.

No production code changes. Pure test/config additions.

## Step 1 — Investigate vitest typecheck integration

- Read vitest.dev/guide/testing-types.html (reference doc).
- Per-package configs at `apps/cli/vitest.config.ts`,
  `packages/shared/vitest.config.ts`, `packages/core/vitest.config.ts`.
  No workspace-level config exists; turbo runs `vitest run` per package.
- Decision: add `typecheck: { enabled: true }` to each per-package
  vitest config. Also add `include` for `*.test-d.ts` pattern so
  vitest picks up those files.

## Step 2 — Z2 wire (config changes)

Files to modify (6 vitest configs, but only 4 packages have test-d files):

1. `apps/cli/vitest.config.ts` — add typecheck, include `.test-d.ts`
2. `packages/shared/vitest.config.ts` — add typecheck, include `.test-d.ts`
3. `packages/core/vitest.config.ts` — add typecheck, include `.test-d.ts`
4. `packages/connectors/claude-code/vitest.config.ts` — add typecheck only
5. `packages/connectors/generic-cli/vitest.config.ts` — add typecheck only
6. `packages/connectors/shared/vitest.config.ts` — add typecheck only

Each config gets:
```ts
typecheck: {
  enabled: true,
  include: ["test/**/*.test-d.ts"],
}
```

And the main `include` array gains `"test/**/*.test-d.ts"`.

## Step 3 — TDD proof (Z2 gate)

- Add `apps/cli/test/known-targets.test-d.ts` with a deliberately broken
  assertion: `expectTypeOf<string>().toEqualTypeOf<number>()`.
- Run `pnpm exec vitest run --project @megasaver/cli` from worktree root.
- Confirm vitest FAILS with a type error (not a runtime error).
- Remove the deliberate failure line.
- Confirm vitest PASSES.

## Step 4 — Z3 test-d files

### `apps/cli/test/known-targets.test-d.ts`
- `KnownTargetId` is exactly `"claude-code" | "codex" | "cursor" | "aider"`
- `KnownTargetId` is NOT `string` (via `@ts-expect-error`)
- `isKnownTargetId("foo")` narrows to `KnownTargetId` in the true branch
- `KNOWN_TARGETS[number]["id"]` resolves to `KnownTargetId` not `string`

### `packages/shared/test/agent-id.test-d.ts`
- `AgentId` is exactly the 5-member literal union
- `agentIdSchema.options` is `readonly [...literal[]]` not `string[]`

### `packages/shared/test/risk-level.test-d.ts`
- `RiskLevel` is exactly `"low" | "medium" | "high" | "critical"`
- `riskLevelSchema.options` type is the tuple literal

### `packages/core/test/memory-scope.test-d.ts`
- `MemoryScope` is exactly `"project" | "session"`
- `memoryScopeSchema.options` type is the tuple literal

## Step 5 — Verification

- `pnpm typecheck` GREEN (existing gate, unaffected)
- `pnpm test` GREEN (all 207+ tests pass, new test-d files pass)
- `pnpm verify` GREEN
- Deliberate-failure proof captured in PR body

## Commit plan

1. `chore: Z2 wire vitest typecheck mode per package` — config changes only
2. `test: Z3 add .test-d.ts regression suites for closed enums` — test files only

## Files changed

Config (6): `apps/cli/vitest.config.ts`, `packages/shared/vitest.config.ts`,
`packages/core/vitest.config.ts`, `packages/connectors/claude-code/vitest.config.ts`,
`packages/connectors/generic-cli/vitest.config.ts`,
`packages/connectors/shared/vitest.config.ts`

Tests (4): `apps/cli/test/known-targets.test-d.ts`,
`packages/shared/test/agent-id.test-d.ts`,
`packages/shared/test/risk-level.test-d.ts`,
`packages/core/test/memory-scope.test-d.ts`
