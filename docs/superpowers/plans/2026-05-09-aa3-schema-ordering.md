# AA3 Schema Ordering Convention Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WHY comments and drift-guard tests to the 3 Zod enum schemas that use intentional non-alphabetic ordering, preventing silent reordering by future contributors.

**Architecture:** Comments-only approach is insufficient because they rely on human review. Drift-guard tests use Zod's `.options` tuple (runtime-accessible ordered array) to lock the canonical order at `pnpm verify` time. Each test is added inside an existing `describe` block — no new files, no new describe wrappers.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, pnpm workspaces, Turborepo.

---

## File Map

| File | Action |
|------|--------|
| `packages/shared/src/agent-id.ts` | Add comment above `agentIdSchema` |
| `packages/shared/test/agent-id.test.ts` | Add drift-guard `it(...)` inside existing `describe("agentIdSchema")` |
| `packages/shared/src/risk-level.ts` | Add comment above `riskLevelSchema` |
| `packages/shared/test/risk-level.test.ts` | Add drift-guard `it(...)` inside existing `describe("riskLevelSchema")` |
| `packages/core/src/memory-entry.ts` | Add comment above `memoryScopeSchema` |
| `packages/core/test/memory-entry.test.ts` | Add drift-guard `it(...)` inside existing `describe("memoryScopeSchema")` |

---

### Task 1: agent-id — comment + drift-guard test

**Files:**
- Modify: `packages/shared/src/agent-id.ts`
- Modify: `packages/shared/test/agent-id.test.ts`

- [ ] **Step 1: Add WHY comment to agent-id.ts**

Open `packages/shared/src/agent-id.ts`. The file currently reads:

```ts
import { z } from "zod";

export const agentIdSchema = z.enum(["aider", "claude-code", "codex", "cursor", "generic-cli"]);

export type AgentId = z.infer<typeof agentIdSchema>;
```

Replace with:

```ts
import { z } from "zod";

// Order: alphabetic. Used as schema-canonical ordering for derived
// CLI error messages and --help text. Do not reorder.
export const agentIdSchema = z.enum(["aider", "claude-code", "codex", "cursor", "generic-cli"]);

export type AgentId = z.infer<typeof agentIdSchema>;
```

- [ ] **Step 2: Add drift-guard test to agent-id.test.ts**

Open `packages/shared/test/agent-id.test.ts`. Locate the closing `});` of the `describe("agentIdSchema", () => {` block (currently after the `"widens to 5 closed-set members"` test at line 51). Add the following test as the last entry inside that describe block, before the closing `});`:

```ts
  it("preserves alphabetic order — AA3 convention", () => {
    expect(agentIdSchema.options).toEqual(["aider", "claude-code", "codex", "cursor", "generic-cli"]);
  });
```

- [ ] **Step 3: Run the new test to verify it passes**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
pnpm --filter @megasaver/shared test -- --reporter=verbose 2>&1 | grep -E "agent-id|AA3|PASS|FAIL|✓|✗"
```

Expected: the new `"preserves alphabetic order — AA3 convention"` test appears as passing. All other tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
git add packages/shared/src/agent-id.ts packages/shared/test/agent-id.test.ts
git commit -m "docs(shared): document agent-id ordering convention"
```

---

### Task 2: risk-level — comment + drift-guard test

**Files:**
- Modify: `packages/shared/src/risk-level.ts`
- Modify: `packages/shared/test/risk-level.test.ts`

- [ ] **Step 1: Add WHY comment to risk-level.ts**

Open `packages/shared/src/risk-level.ts`. The file currently reads:

```ts
import { z } from "zod";

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;
```

Replace with:

```ts
import { z } from "zod";

// Order: severity-ascending (low → critical). Human-readable progression
// for --help / error messages. Do not alphabetize.
export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;
```

- [ ] **Step 2: Add drift-guard test to risk-level.test.ts**

Open `packages/shared/test/risk-level.test.ts`. Locate the closing `});` of `describe("riskLevelSchema", () => {` (currently after the property test at line 39). Add the following test as the last entry inside that describe block, before the closing `});`:

```ts
  it("preserves severity-ascending order — AA3 convention", () => {
    expect(riskLevelSchema.options).toEqual(["low", "medium", "high", "critical"]);
  });
```

- [ ] **Step 3: Run the new test to verify it passes**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
pnpm --filter @megasaver/shared test -- --reporter=verbose 2>&1 | grep -E "risk-level|AA3|PASS|FAIL|✓|✗"
```

Expected: `"preserves severity-ascending order — AA3 convention"` passes. All other tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
git add packages/shared/src/risk-level.ts packages/shared/test/risk-level.test.ts
git commit -m "docs(shared): document risk-level ordering convention"
```

---

### Task 3: memory-scope — comment + drift-guard test

**Files:**
- Modify: `packages/core/src/memory-entry.ts`
- Modify: `packages/core/test/memory-entry.test.ts`

- [ ] **Step 1: Add WHY comment to memory-entry.ts**

Open `packages/core/src/memory-entry.ts`. Line 4 currently reads:

```ts
export const memoryScopeSchema = z.enum(["project", "session"]);
```

Replace lines 3-4 with:

```ts
// Order: semantic — project precedes session because sessions belong to
// projects (containment hierarchy). Used for derived CLI strings.
export const memoryScopeSchema = z.enum(["project", "session"]);
```

- [ ] **Step 2: Add drift-guard test to memory-entry.test.ts**

Open `packages/core/test/memory-entry.test.ts`. Locate `describe("memoryScopeSchema", () => {` (starts at line 30). It currently contains two tests and its closing `});` is at line 39. Add the following test as the last entry inside that describe block, before the closing `});`:

```ts
  it("preserves semantic order project→session — AA3 convention", () => {
    expect(memoryScopeSchema.options).toEqual(["project", "session"]);
  });
```

- [ ] **Step 3: Run the new test to verify it passes**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
pnpm --filter @megasaver/core test -- --reporter=verbose 2>&1 | grep -E "memoryScopeSchema|AA3|PASS|FAIL|✓|✗"
```

Expected: `"preserves semantic order project→session — AA3 convention"` passes. All other tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
git add packages/core/src/memory-entry.ts packages/core/test/memory-entry.test.ts
git commit -m "docs(core): document memory-scope ordering convention"
```

---

### Task 4: DoD gate — full verify + spec commit

**Files:** none modified (verification + spec commit only)

- [ ] **Step 1: Run full pnpm verify**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
pnpm verify
```

Expected: exits 0. lint + typecheck + test all green. If any failure, fix before proceeding.

- [ ] **Step 2: Commit the spec and plan docs**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
git add docs/superpowers/specs/2026-05-09-aa3-schema-ordering-design.md docs/superpowers/plans/2026-05-09-aa3-schema-ordering.md
git commit -m "docs: add AA3 schema ordering spec and plan"
```

- [ ] **Step 3: Push and open PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa3-schema-ordering
git push -u origin feat/aa3-schema-ordering
gh pr create --title "docs(schemas): document enum member-ordering conventions (AA3)" --body "$(cat <<'EOF'
## Summary

- Adds WHY comments to `agentIdSchema`, `riskLevelSchema`, and `memoryScopeSchema` explaining the chosen member ordering (alphabetic, severity-ascending, and semantic hierarchy respectively).
- Adds one drift-guard test per schema inside existing `describe` blocks, locking canonical order at `pnpm verify` time.
- Zero runtime change — all new tests pass immediately against current state; their value is catching future silent reorders.

Closes critic finding AA3 from PR #23.

## Test plan

- [ ] `pnpm verify` green
- [ ] Each new `AA3 convention` test passes
- [ ] No existing tests regressed
EOF
)"
```

- [ ] **Step 4: Send PR URL to team-lead**

After `gh pr create` outputs the PR URL, send it to `team-lead` via SendMessage.
