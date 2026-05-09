---
title: AA3 — Schema Member-Ordering Convention Docs
date: 2026-05-09
risk: LOW
status: approved
---

## Problem

Three Zod enum schemas in the codebase use different, intentional member orderings:

- `agentIdSchema` — alphabetic
- `riskLevelSchema` — severity-ascending
- `memoryScopeSchema` — semantic (containment hierarchy)

None carry a comment explaining WHY. A future "tidy" PR could silently reorder them (e.g., alphabetize `riskLevelSchema`) and break human-readable CLI output without any test catching it.

## Goal

1. Add a one-line WHY comment above each of the 3 schema declarations.
2. Add one drift-guard assertion per schema inside the existing `describe` blocks, locking the order at `pnpm verify` time.

Zero runtime change. The new tests pass against current state immediately; their value is catching future reorder.

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/agent-id.ts` | Add WHY comment above `agentIdSchema` |
| `packages/shared/src/risk-level.ts` | Add WHY comment above `riskLevelSchema` |
| `packages/core/src/memory-entry.ts` | Add WHY comment above `memoryScopeSchema` |
| `packages/shared/test/agent-id.test.ts` | Add drift-guard `it(...)` inside existing `describe` |
| `packages/shared/test/risk-level.test.ts` | Add drift-guard `it(...)` inside existing `describe` |
| `packages/core/test/memory-entry.test.ts` | Add drift-guard `it(...)` inside existing `describe("memoryScopeSchema")` |

## Comments

```ts
// packages/shared/src/agent-id.ts
// Order: alphabetic. Used as schema-canonical ordering for derived
// CLI error messages and --help text. Do not reorder.
export const agentIdSchema = z.enum(["aider", "claude-code", "codex", "cursor", "generic-cli"]);
```

```ts
// packages/shared/src/risk-level.ts
// Order: severity-ascending (low → critical). Human-readable progression
// for --help / error messages. Do not alphabetize.
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
```

```ts
// packages/core/src/memory-entry.ts
// Order: semantic — project precedes session because sessions belong to
// projects (containment hierarchy). Used for derived CLI strings.
export const memoryScopeSchema = z.enum(["project", "session"]);
```

## Drift-Guard Tests

Each added inside the existing `describe` block (no new file, no new describe):

```ts
// agent-id.test.ts
it("preserves alphabetic order — AA3 convention", () => {
  expect(agentIdSchema.options).toEqual(["aider", "claude-code", "codex", "cursor", "generic-cli"]);
});
```

```ts
// risk-level.test.ts
it("preserves severity-ascending order — AA3 convention", () => {
  expect(riskLevelSchema.options).toEqual(["low", "medium", "high", "critical"]);
});
```

```ts
// memory-entry.test.ts — inside describe("memoryScopeSchema")
it("preserves semantic order project→session — AA3 convention", () => {
  expect(memoryScopeSchema.options).toEqual(["project", "session"]);
});
```

## Out of Scope

- No reordering of any enum members.
- No new exports.
- No new test files or describe blocks.
- No changes to `index.ts` re-exports.

## Commit Strategy

One commit per schema (3 commits) keeps git bisect clean:
1. `docs(shared): document agent-id ordering convention`
2. `docs(shared): document risk-level ordering convention`
3. `docs(core): document memory-scope ordering convention`
