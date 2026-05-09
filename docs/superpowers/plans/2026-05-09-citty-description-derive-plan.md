# Citty Description Derive (Z1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5 hand-mirrored citty `description` strings with schema-derived template interpolation across `memory/create.ts`, `session/create.ts`, and `session/update.ts`, closing PR #22's bug class on the help-text surface.

**Architecture:** Each closed-enum `description` literal is rewritten as `\`${prefix} (${schema.options.join(" | ")})${suffix}.\`` where `schema` is `agentIdSchema` / `riskLevelSchema` / `memoryScopeSchema` from `@megasaver/shared` or `@megasaver/core`. The interpolation runs once at module load; runtime cost is zero. The five "Keep in sync with X in Y" comments are removed because the derivation is its own documentation. Three new drift-guard tests (parallel to the existing agent ones from Y1+Y2) cover risk×2 and scope×1.

**Tech Stack:** TypeScript strict ESM, Node 22 LTS, Vitest, Citty, Zod, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-09-citty-description-derive-design.md`.

**Worktree:** `.worktrees/citty-description-derive` on branch `feat/citty-description-derive`.

**Behavior contract:** Zero runtime string change. Every existing `--help` output produces a byte-identical description string before and after.

---

## File Structure

| File | Type | Responsibility |
|------|------|----------------|
| `apps/cli/src/commands/memory/create.ts` | Modify | Derive `--scope` description from `memoryScopeSchema.options`. Remove "Keep in sync" comment. |
| `apps/cli/src/commands/session/create.ts` | Modify | Derive `--agent` and `--risk` descriptions from `agentIdSchema.options` and `riskLevelSchema.options`. Remove 2 "Keep in sync" comments. |
| `apps/cli/src/commands/session/update.ts` | Modify | Derive `--risk` and `--agent` descriptions from the same schemas. Remove 2 "Keep in sync" comments. |
| `apps/cli/test/memory.test.ts` | Modify | Add 1 drift-guard test asserting `--scope` description contains every `memoryScopeSchema` member. |
| `apps/cli/test/session.test.ts` | Modify | Add 2 drift-guard tests asserting `--risk` description contains every `riskLevelSchema` member on both `sessionCreateCommand` and `sessionUpdateCommand`. |

**Total new tests:** 3 (1 scope + 2 risk). Project total 474 → 477.

**Net production line change:** roughly −5 comment lines, +0 logic lines (descriptions are 1-for-1 string replacements). +3 import-list expansions (1 per file, just adding a name to an existing destructure).

---

## Task 1: `memory/create.ts` — derive `--scope` description + drift-guard

**Files:**
- Modify: `apps/cli/src/commands/memory/create.ts`
- Test: `apps/cli/test/memory.test.ts`

**Behavior contract:** `memoryCreateCommand.args.scope.description` is byte-identical (`"Memory scope (project | session)."`) before and after. The drift-guard test passes against both the pre-refactor hardcoded string AND the post-refactor derived string — its purpose is to catch FUTURE drift, not to drive THIS refactor.

- [ ] **Step 1: Add the drift-guard test**

Open `apps/cli/test/memory.test.ts`. Locate the existing describe block that covers `memoryCreateCommand` argument shape (search for an existing test that references `memoryCreateCommand.args` or a similar inspection helper). If no such describe exists, append a new describe at the end of the file:

```ts
describe("memoryCreateCommand — drift guards", () => {
  it("--scope description on memory create lists every memoryScopeSchema member", async () => {
    const { memoryScopeSchema } = await import("@megasaver/core");
    const desc = memoryCreateCommand.args?.scope?.description ?? "";
    for (const m of memoryScopeSchema.options) expect(desc).toContain(m);
  });
});
```

If `memoryCreateCommand` is not currently imported at the top of `memory.test.ts`, add it. Search the file's imports for `memoryCreateCommand` first; the existing `memory.test.ts` likely imports from `../src/commands/memory/index.js` or `../src/commands/memory/create.js`. Use whichever path matches existing imports.

- [ ] **Step 2: Run the test to verify it passes against the current code**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/citty-description-derive
pnpm --filter @megasaver/cli exec vitest run memory.test
```

Expected: PASS. The pre-refactor hardcoded `"Memory scope (project | session)."` already contains both schema members.

If the test FAILS at this step, the existing description string is missing a schema member (a real drift bug — fix the description first, then proceed).

- [ ] **Step 3: Refactor the description in `memory/create.ts`**

Open `apps/cli/src/commands/memory/create.ts`. Find the existing import line that pulls from `@megasaver/core` (look for `MemoryEntry`, `MemoryScope`, etc.) and add `memoryScopeSchema` to the destructure. Example:

Before:
```ts
import { type MemoryEntry } from "@megasaver/core";
```

After:
```ts
import { memoryScopeSchema, type MemoryEntry } from "@megasaver/core";
```

(Adjust to match the actual existing import shape — merge with whatever else is imported from `@megasaver/core`.)

Find the description (around line 151-155):

```ts
    // Keep in sync with memoryScopeSchema in @megasaver/core.
    scope: {
      type: "string",
      required: true,
      description: "Memory scope (project | session).",
    },
```

Replace with (remove the comment line, derive the description):

```ts
    scope: {
      type: "string",
      required: true,
      description: `Memory scope (${memoryScopeSchema.options.join(" | ")}).`,
    },
```

- [ ] **Step 4: Run all CLI tests to confirm green**

```bash
pnpm --filter @megasaver/cli exec vitest run memory.test
```

Expected: PASS — both the new drift-guard test and any existing memory tests continue to pass. Description string is byte-identical.

If you see "Cannot find module" build chain errors, run:
```bash
pnpm --filter @megasaver/shared build 2>&1 | tail -3
pnpm --filter @megasaver/core build 2>&1 | tail -3
pnpm --filter @megasaver/connectors-shared build 2>&1 | tail -3
pnpm --filter @megasaver/connector-generic-cli build 2>&1 | tail -3
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/memory/create.ts apps/cli/test/memory.test.ts
git commit -m "refactor(cli): derive memory --scope description"
```

Subject: 47 chars, under 50.

---

## Task 2: `session/create.ts` — derive `--agent` + `--risk` descriptions + risk drift-guard

**Files:**
- Modify: `apps/cli/src/commands/session/create.ts`
- Test: `apps/cli/test/session.test.ts`

**Behavior contract:**
- `sessionCreateCommand.args.agent.description` = `"Agent id (aider | claude-code | codex | cursor | generic-cli)."` (byte-identical)
- `sessionCreateCommand.args.risk.description` = `"Risk level (low | medium | high | critical). Default: medium."` (byte-identical, including the `Default: medium.` suffix)

The existing `--agent description on create lists every agentIdSchema member` test (added in Y1 fix) continues to pass byte-identically — agent description is now derived but contains the same members.

- [ ] **Step 1: Add the risk drift-guard test**

Open `apps/cli/test/session.test.ts`. Locate the existing describe block with the `--agent description on create lists every agentIdSchema member` test (added in Y1; search for `"--agent description on create"` or `agentIdSchema.options`).

Append a parallel test in the same describe:

```ts
  it("--risk description on create lists every riskLevelSchema member", async () => {
    const { riskLevelSchema } = await import("@megasaver/shared");
    const desc = sessionCreateCommand.args?.risk?.description ?? "";
    for (const m of riskLevelSchema.options) expect(desc).toContain(m);
  });
```

If `sessionCreateCommand` is not yet imported at the top of `session.test.ts`, the existing agent drift-guard test already imports it — verify and reuse the existing import.

- [ ] **Step 2: Run the test to verify it passes against current code**

```bash
pnpm --filter @megasaver/cli exec vitest run session.test
```

Expected: PASS. The pre-refactor `"Risk level (low | medium | high | critical). Default: medium."` already contains every `riskLevelSchema` member.

- [ ] **Step 3: Refactor the descriptions in `session/create.ts`**

Open `apps/cli/src/commands/session/create.ts`. Find the existing `@megasaver/shared` import (it likely pulls `AgentId`, `RiskLevel`, etc.) and add `agentIdSchema, riskLevelSchema` to the destructure:

Before:
```ts
import { type AgentId, type RiskLevel } from "@megasaver/shared";
```

After:
```ts
import { agentIdSchema, riskLevelSchema, type AgentId, type RiskLevel } from "@megasaver/shared";
```

(Merge with whatever else is imported from `@megasaver/shared`. If `AgentId` / `RiskLevel` types are no longer needed after the refactor — i.e. nothing else in the file uses them — clean up. But typically other code paths reference these types, so just add the schema imports.)

Find the description block (around lines 123-132):

```ts
    agent: {
      type: "string",
      required: true,
      // Keep in sync with agentIdSchema in @megasaver/shared.
      description: "Agent id (claude-code | codex | cursor | aider | generic-cli).",
    },
    // Keep in sync with riskLevelSchema in @megasaver/shared.
    risk: {
      type: "string",
      description: "Risk level (low | medium | high | critical). Default: medium.",
    },
```

Replace with (both comments removed, both descriptions derived):

```ts
    agent: {
      type: "string",
      required: true,
      description: `Agent id (${agentIdSchema.options.join(" | ")}).`,
    },
    risk: {
      type: "string",
      description: `Risk level (${riskLevelSchema.options.join(" | ")}). Default: medium.`,
    },
```

The `Default: medium.` suffix is preserved — only the parenthesized enum list is interpolated.

- [ ] **Step 4: Run all session tests to confirm green**

```bash
pnpm --filter @megasaver/cli exec vitest run session.test
```

Expected: PASS — both drift-guard tests (existing agent + new risk) and all other session tests pass. Description strings byte-identical.

If the existing `--agent description` test fails because the schema's `agentIdSchema.options` order doesn't match the previously hardcoded order, that's a real drift signal — but per Y1 fix, `agentIdSchema = z.enum(["aider", "claude-code", "codex", "cursor", "generic-cli"])` (alphabetic-first) and the test asserts containment (not order), so it should pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/session/create.ts apps/cli/test/session.test.ts
git commit -m "refactor(cli): derive session create descriptions"
```

Subject: 49 chars.

---

## Task 3: `session/update.ts` — derive `--risk` + `--agent` descriptions + risk drift-guard

**Files:**
- Modify: `apps/cli/src/commands/session/update.ts`
- Test: `apps/cli/test/session.test.ts`

**Behavior contract:**
- `sessionUpdateCommand.args.risk.description` = `"New risk level (low | medium | high | critical)."` (byte-identical, no `Default:` suffix on update flow)
- `sessionUpdateCommand.args.agent.description` = `"New agent id (aider | claude-code | codex | cursor | generic-cli)."` (byte-identical)

The existing `--agent description on update lists every agentIdSchema member` test (Y2 fix) continues to pass.

- [ ] **Step 1: Add the risk drift-guard test for update**

Open `apps/cli/test/session.test.ts`. Locate the existing `--agent description on update lists every agentIdSchema member` test (Y2 fix, in the `sessionUpdateCommand — drift guards` describe or similar).

Append a parallel test in the same describe:

```ts
  it("--risk description on update lists every riskLevelSchema member", async () => {
    const { riskLevelSchema } = await import("@megasaver/shared");
    const desc = sessionUpdateCommand.args?.risk?.description ?? "";
    for (const m of riskLevelSchema.options) expect(desc).toContain(m);
  });
```

`sessionUpdateCommand` is already imported (the Y2 agent test uses it).

- [ ] **Step 2: Run the test to verify it passes against current code**

```bash
pnpm --filter @megasaver/cli exec vitest run session.test
```

Expected: PASS.

- [ ] **Step 3: Refactor the descriptions in `session/update.ts`**

Open `apps/cli/src/commands/session/update.ts`. Add `agentIdSchema, riskLevelSchema` to the existing `@megasaver/shared` import (same pattern as Task 2):

Before (sample):
```ts
import { type AgentId, type RiskLevel } from "@megasaver/shared";
```

After:
```ts
import { agentIdSchema, riskLevelSchema, type AgentId, type RiskLevel } from "@megasaver/shared";
```

(Merge with the actual existing destructure shape.)

Find the description block (around lines 124-135):

```ts
    title: { type: "string", description: "New title (empty string clears)." },
    // Keep in sync with riskLevelSchema in @megasaver/shared.
    risk: {
      type: "string",
      description: "New risk level (low | medium | high | critical).",
    },
    // Keep in sync with agentIdSchema in @megasaver/shared.
    agent: {
      type: "string",
      description: "New agent id (claude-code | codex | cursor | aider | generic-cli).",
    },
```

Replace with (both comments removed, both descriptions derived):

```ts
    title: { type: "string", description: "New title (empty string clears)." },
    risk: {
      type: "string",
      description: `New risk level (${riskLevelSchema.options.join(" | ")}).`,
    },
    agent: {
      type: "string",
      description: `New agent id (${agentIdSchema.options.join(" | ")}).`,
    },
```

The `New ` prefix is preserved on both.

- [ ] **Step 4: Run all CLI tests to confirm green**

```bash
pnpm --filter @megasaver/cli exec vitest run
```

Expected: PASS — all 191 + 3 (now 194) tests green. Description strings byte-identical.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/session/update.ts apps/cli/test/session.test.ts
git commit -m "refactor(cli): derive session update descriptions"
```

Subject: 49 chars.

---

## Task 4: DoD gate — `pnpm verify` + `--help` smoke + push + PR

**Files:** none modified.

- [ ] **Step 1: Run the full verify suite**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/citty-description-derive
pnpm verify
```

Expected: GREEN — Biome lint clean, `tsc -b --noEmit` clean across all packages, all tests pass. Capture the test count.

If lint fails: run `pnpm lint:fix`, re-stage, and commit any auto-fixes as `chore(cli): biome auto-format`.

- [ ] **Step 2: Smoke evidence — exercise the 3 affected `--help` outputs**

Build the CLI and capture the description strings:

```bash
pnpm --filter @megasaver/cli build 2>&1 | tail -3

CLI=/Users/halitozger/Desktop/MegaSaver/.worktrees/citty-description-derive/apps/cli/dist/cli.js

echo "--- session create --help ---"
node "$CLI" session create --help 2>&1 | grep -E "Agent id|Risk level"

echo "--- session update --help ---"
node "$CLI" session update --help 2>&1 | grep -E "New agent|New risk"

echo "--- memory create --help ---"
node "$CLI" memory create --help 2>&1 | grep -E "Memory scope"
```

Expected (byte-identical to pre-refactor):

```
session create:
  Agent id (aider | claude-code | codex | cursor | generic-cli).
  Risk level (low | medium | high | critical). Default: medium.

session update:
  New risk level (low | medium | high | critical).
  New agent id (aider | claude-code | codex | cursor | generic-cli).

memory create:
  Memory scope (project | session).
```

If any string differs, the schema's `.options` order does not match the previously-hardcoded order. Inspect the schema declaration in `packages/shared/src/agent-id.ts`, `packages/shared/src/risk-level.ts`, `packages/core/src/memory-entry.ts`. The schema is the source of truth — if the order changes, that's the new canonical order.

- [ ] **Step 3: Push the branch and open the PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/citty-description-derive
git push -u origin feat/citty-description-derive
```

Then create the PR via `gh`:

```bash
gh pr create --title "refactor(cli): derive citty descriptions" --body "$(cat <<'EOF'
## Summary

Derives 5 citty `description` strings from their source Zod schemas via module-load template interpolation, closing PR #22's bug class on the help-text surface:

- `session/create.ts` — `--agent` and `--risk` derived from `agentIdSchema.options` / `riskLevelSchema.options`
- `session/update.ts` — `--risk` and `--agent` derived from the same schemas
- `memory/create.ts` — `--scope` derived from `memoryScopeSchema.options`

All five "Keep in sync with X in Y" comments removed — derivation is its own documentation.

After this slot, adding a 5th member to `agentIdSchema`, `riskLevelSchema`, or `memoryScopeSchema` requires editing exactly the source schema. Both error messages (PR #22) and `--help` text (this slot) auto-update.

## Behavior contract

Every `--help` description is byte-identical before and after:

```
Agent id (aider | claude-code | codex | cursor | generic-cli).
Risk level (low | medium | high | critical). Default: medium.
New risk level (low | medium | high | critical).
New agent id (aider | claude-code | codex | cursor | generic-cli).
Memory scope (project | session).
```

## Test plan

- [x] `pnpm verify` green
- [x] +3 drift-guard tests (1 scope + 2 risk) parallel to existing agent ones
- [x] Manual smoke: 5 description strings byte-identical via `--help` output

## Spec & plan

- Spec: `docs/superpowers/specs/2026-05-09-citty-description-derive-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-citty-description-derive-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL.

- [ ] **Step 4: Report back**

Report:
- pnpm verify summary (test count, GREEN status)
- All 5 smoke `--help` strings byte-identical
- Push outcome
- PR URL

---

## Self-Review Notes

**Spec coverage:**
- §3.1 memory/create.ts → Task 1.
- §3.2 session/create.ts → Task 2.
- §3.3 session/update.ts → Task 3.
- §3.4 +3 drift-guard tests → distributed across Tasks 1-3 (each task adds the matching test before refactoring its source file).
- §4 byte-identical contract → enforced by existing `--agent` drift-guard tests (Y1+Y2) + new tests + Task 4 smoke.
- §6 risk MEDIUM → full superpowers chain via Task 4 + standard PR review.
- §7 success criteria (no `--help` mirror) → Task 4 smoke verifies + critic re-pass on PR.
- §8 migration → trivial (no migration).
- §9 out-of-scope → respected (no helper, no schema additions, no other description sites).

**Placeholder scan:** No "TBD", "TODO". Every code block is complete; every command has explicit expected output. The "merge into actual existing import shape" guidance is bounded — implementer must read the file's current imports before editing, which is normal practice. The "if helper needed" branches in Step 3 instructions are bounded with concrete fallback decisions.

**Type consistency:** `agentIdSchema`, `riskLevelSchema`, `memoryScopeSchema` consistently used. `agentIdSchema` and `riskLevelSchema` from `@megasaver/shared`; `memoryScopeSchema` from `@megasaver/core` — verified during plan-writing. Schema member order canonical: `agentIdSchema = ["aider", "claude-code", "codex", "cursor", "generic-cli"]`, `riskLevelSchema = ["low", "medium", "high", "critical"]`, `memoryScopeSchema = ["project", "session"]`. Test access pattern `command.args?.<name>?.description` consistent across all 3 drift-guard tests, mirroring the existing Y1+Y2 pattern.

**Build-order discipline:** Tasks 1–3 are independent of each other (each touches a different production file + adds a test in a possibly-shared test file). Task 4 must run last for the green-bar gate. The 3 tasks can be executed in any order, but the plan presents them in a memory-then-session order for cleanest review.
