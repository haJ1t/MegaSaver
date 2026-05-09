# Closed-enum Tripwire Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the broken `as const satisfies readonly T[]` tripwire pattern in `apps/cli/src/errors.ts` and `apps/cli/src/commands/connector.ts` by deriving every closed-set list from a single source of truth (Zod `schema.options` for agent/risk/scope, a new `known-targets.ts` registry for connector target IDs).

**Architecture:** Replace 4 hand-maintained tuple constants in `errors.ts` with derivations: `agentIdSchema.options`, `riskLevelSchema.options`, `memoryScopeSchema.options` (from `@megasaver/shared` and `@megasaver/core`), and `KNOWN_TARGET_IDS` imported from a new `apps/cli/src/known-targets.ts` (which derives IDs from `KNOWN_TARGETS.map((t) => t.id)`). The two `KNOWN_TARGET_IDS` duplicates (one in `errors.ts`, one in `connector.ts`) collapse to a single source. Individual target consts in `packages/connectors/generic-cli/src/targets.ts` drop their `: ConnectorTarget` annotations so `id` stays a literal type, making `(typeof KNOWN_TARGETS)[number]["id"]` resolve to a true literal union for `KnownTargetId`.

**Tech Stack:** TypeScript strict ESM, Node 22 LTS, Vitest (with `expectTypeOf`), Citty, Zod, pnpm workspaces, Turborepo.

**Spec:** `docs/superpowers/specs/2026-05-09-closed-enum-tripwire-design.md`.

**Worktree:** `.worktrees/closed-enum-tripwire` on branch `feat/closed-enum-tripwire`.

**Behavior contract:** Zero runtime string changes. Every existing CLI error message produces a byte-identical output before and after this refactor. Pre-existing pinned-string tests pass without modification.

---

## File Structure

| File | Type | Responsibility |
|------|------|----------------|
| `packages/connectors/generic-cli/src/targets.ts` | Modify | Drop `: ConnectorTarget` annotations from `codexTarget`/`cursorTarget`/`aiderTarget` so `id`/`relativePath` stay literal. |
| `apps/cli/src/known-targets.ts` | Create | CLI-internal canonical registry. Owns `CLAUDE_CODE_TARGET`, `KNOWN_TARGETS`, derived `KNOWN_TARGET_IDS`, `KnownTargetId` type, `isKnownTargetId` helper. |
| `apps/cli/test/known-targets.test.ts` | Create | Runtime drift-guard test (`KNOWN_TARGET_IDS = KNOWN_TARGETS.map(...)`) + `isKnownTargetId` narrowing test + inline `expectTypeOf` literal-union assertion. |
| `apps/cli/src/commands/connector.ts` | Modify | Remove inline `CLAUDE_CODE_TARGET`, `KNOWN_TARGETS`, `KNOWN_TARGET_IDS`, `KnownTargetId`, `isKnownTargetId`. Import from `../known-targets.js`. |
| `apps/cli/src/errors.ts` | Modify | Remove `AGENT_VALUES`, `RISK_VALUES`, `KNOWN_TARGET_IDS`, `KNOWN_SCOPE_IDS` constants. Use `agentIdSchema.options`, `riskLevelSchema.options`, `memoryScopeSchema.options` directly. Import `KNOWN_TARGET_IDS` from `./known-targets.js`. |
| `apps/cli/test/errors.test.ts` | Modify | Add 3 schema-derivation drift-guard tests (`invalidAgentMessage` / `invalidRiskMessage` / `invalidScopeMessage` enumerate every schema member). |

**Total new tests:** 5 (3 errors-derivation + 2 known-targets runtime). Plus 1 inline `expectTypeOf` type-level assertion. Project total 466 → ~471–472.

**Net production line change:** roughly −20 lines (4 constants removed in errors.ts, ~15 lines moved out of connector.ts) + ~30 lines added in known-targets.ts ≈ +10 net.

---

## Task 1: Narrow target types in `@megasaver/connector-generic-cli`

**Files:**
- Modify: `packages/connectors/generic-cli/src/targets.ts`

**Why this task is first:** Without it, `(typeof KNOWN_TARGETS)[number]["id"]` resolves to `string` (because `codexTarget: ConnectorTarget` widens `id` to `string`). Task 2's `KnownTargetId` literal-union assertion would fail.

**Pure type refactor:** No runtime value changes, no test changes. Existing tests continue to pass byte-identically because `toEqual({...})` checks runtime values.

- [ ] **Step 1: Read current state**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/closed-enum-tripwire
cat packages/connectors/generic-cli/src/targets.ts
```

- [ ] **Step 2: Remove `: ConnectorTarget` annotation from each target const**

Edit `packages/connectors/generic-cli/src/targets.ts`. Keep `Object.freeze` and `satisfies AgentId`. Final file:

```ts
import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
  readonly header?: string;
}

export const codexTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const cursorTarget = Object.freeze({
  id: "cursor",
  agentId: "cursor" satisfies AgentId,
  relativePath: ".cursor/rules/megasaver.mdc",
  header: [
    "---",
    "description: Mega Saver project context (auto-managed block)",
    "alwaysApply: true",
    "---",
    "",
    "",
  ].join("\n"),
});

export const aiderTarget = Object.freeze({
  id: "aider",
  agentId: "aider" satisfies AgentId,
  relativePath: "CONVENTIONS.md",
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
  aiderTarget,
]);

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
```

The only changes: `: ConnectorTarget` annotation removed from the three target const declarations. `builtinTargets` keeps its `: readonly ConnectorTarget[]` annotation (its public contract is the wider array type). `findTarget` return type is unchanged.

- [ ] **Step 3: Build the dependency chain**

```bash
pnpm --filter @megasaver/shared build 2>&1 | tail -5
pnpm --filter @megasaver/connectors-shared build 2>&1 | tail -5
pnpm --filter @megasaver/connector-generic-cli build 2>&1 | tail -5
```

(The chain is needed because Task 2 will consume the built `dist/` of generic-cli. Build now to surface any type errors from the annotation drop.)

Expected: all three builds succeed.

- [ ] **Step 4: Run the package's tests to confirm runtime values unchanged**

```bash
pnpm --filter @megasaver/connector-generic-cli exec vitest run
```

Expected: 29 pass (the existing test count after the aider slot). The `targets.test.ts` `toEqual({...})` assertions check runtime values, which are unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/generic-cli/src/targets.ts
git commit -m "refactor(generic-cli): narrow target types"
```

---

## Task 2: Create `apps/cli/src/known-targets.ts` (single source of truth)

**Files:**
- Create: `apps/cli/src/known-targets.ts`
- Create: `apps/cli/test/known-targets.test.ts`

**TDD order:** write tests first, watch them fail (file does not exist), create the file, watch them pass.

- [ ] **Step 1: Write the failing test file**

Create `apps/cli/test/known-targets.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CLAUDE_CODE_TARGET,
  KNOWN_TARGETS,
  KNOWN_TARGET_IDS,
  type KnownTargetId,
  isKnownTargetId,
} from "../src/known-targets.js";

describe("known-targets", () => {
  it("KNOWN_TARGET_IDS derives from KNOWN_TARGETS in launch order", () => {
    expect(KNOWN_TARGET_IDS).toEqual(KNOWN_TARGETS.map((t) => t.id));
  });

  it("KNOWN_TARGETS includes claude-code, codex, cursor, aider in launch order", () => {
    expect(KNOWN_TARGETS.map((t) => t.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "aider",
    ]);
  });

  it("CLAUDE_CODE_TARGET shape matches the inline definition contract", () => {
    expect(CLAUDE_CODE_TARGET.id).toBe("claude-code");
    expect(CLAUDE_CODE_TARGET.agentId).toBe("claude-code");
    expect(CLAUDE_CODE_TARGET.relativePath).toBe("CLAUDE.md");
  });

  it("isKnownTargetId narrows known ids and rejects unknown ones", () => {
    expect(isKnownTargetId("claude-code")).toBe(true);
    expect(isKnownTargetId("codex")).toBe(true);
    expect(isKnownTargetId("cursor")).toBe(true);
    expect(isKnownTargetId("aider")).toBe(true);
    expect(isKnownTargetId("totally-fake")).toBe(false);
    expect(isKnownTargetId("")).toBe(false);
  });

  it("KnownTargetId resolves to the closed literal union", () => {
    expectTypeOf<KnownTargetId>().toEqualTypeOf<
      "claude-code" | "codex" | "cursor" | "aider"
    >();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/closed-enum-tripwire
pnpm --filter @megasaver/cli exec vitest run known-targets
```

Expected: FAIL — the test file imports from `../src/known-targets.js` which does not exist; Vitest will report a transform / resolve error.

- [ ] **Step 3: Create the new module**

Create `apps/cli/src/known-targets.ts`:

```ts
import type { AgentId } from "@megasaver/shared";
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import { aiderTarget, codexTarget, cursorTarget } from "@megasaver/connector-generic-cli";

export const CLAUDE_CODE_TARGET = {
  id: "claude-code",
  agentId: "claude-code" satisfies AgentId,
  relativePath: "CLAUDE.md",
} as const;

export const KNOWN_TARGETS = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
] as const satisfies readonly ConnectorTarget[];

export const KNOWN_TARGET_IDS: readonly string[] = KNOWN_TARGETS.map((t) => t.id);

export type KnownTargetId = (typeof KNOWN_TARGETS)[number]["id"];

export function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}
```

Key shape decisions (matching spec §3.1):
- `CLAUDE_CODE_TARGET` uses `as const` (no `: ConnectorTarget` annotation) so `id` stays the literal `"claude-code"`, mirroring the Task 1 narrowing of the other three targets.
- `KNOWN_TARGETS` pairs `as const` (preserves tuple element types) with `satisfies readonly ConnectorTarget[]` (validates each entry is a `ConnectorTarget`). The pairing keeps the literal-union derivation working while still enforcing the interface constraint at the array level.
- `KNOWN_TARGET_IDS` is derived via `.map()` from a single source. The annotation `readonly string[]` accepts the runtime return type — the literal-union narrowing is provided by the `KnownTargetId` type, not by this constant.
- `isKnownTargetId` casts to `readonly string[]` for the `.includes()` call (the type-narrowing predicate uses `KnownTargetId` as the return type).

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @megasaver/cli exec vitest run known-targets
```

Expected: 5 runtime tests PASS. The inline `expectTypeOf<KnownTargetId>().toEqualTypeOf<"claude-code" | "codex" | "cursor" | "aider">()` is a compile-time assertion baked into the runtime test execution; if `KnownTargetId` were `string`, vitest would report a TypeScript error during test compilation. (Vitest 2.1.x compiles TS via tsx/esbuild during test discovery — `expectTypeOf` failures surface as transform errors.)

If the type assertion fails, it means Task 1's annotation drop did not propagate (verify Task 1 is committed and the chain was rebuilt).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/known-targets.ts apps/cli/test/known-targets.test.ts
git commit -m "feat(cli): add known-targets registry"
```

---

## Task 3: Refactor `connector.ts` to use `known-targets.ts`

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`

**Behavior contract:** Zero runtime change. The `KNOWN_TARGETS` array and `KNOWN_TARGET_IDS` tuple were already byte-identical between the old inline definition and the new imported version. Existing tests in `connector.test.ts` and `connector-status.test.ts` (41 + memory tests) pass without modification.

- [ ] **Step 1: Read current state**

```bash
sed -n '1,60p' apps/cli/src/commands/connector.ts
```

You'll see imports plus the inline definitions of `KNOWN_TARGET_IDS`, `KnownTargetId`, `isKnownTargetId`, `CLAUDE_CODE_TARGET`, and `KNOWN_TARGETS` (roughly lines 14–44).

- [ ] **Step 2: Replace inline definitions with imports**

Edit `apps/cli/src/commands/connector.ts`. Update the top of the file. The exact "before" pattern is:

```ts
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ConnectorTarget, aiderTarget, codexTarget, cursorTarget } from "@megasaver/connector-generic-cli";
import {
  type ConnectorContext,
  assertProjectRoot,
  parseBlock,
  readTargetFile,
  renderBlock,
  upsertBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import type { MemoryEntry, Project, Session } from "@megasaver/core";
import { defineCommand } from "citty";
import { invalidTargetMessage, mapErrorToCliMessage, projectNotFoundMessage } from "../errors.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";
import { projectNameSchema } from "./shared/schemas.js";

// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts.
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor", "aider"] as const;
type KnownTargetId = (typeof KNOWN_TARGET_IDS)[number];

function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}

const CLAUDE_CODE_TARGET: ConnectorTarget = {
  id: "claude-code",
  agentId: "claude-code",
  relativePath: "CLAUDE.md",
};

const KNOWN_TARGETS: readonly ConnectorTarget[] = [CLAUDE_CODE_TARGET, codexTarget, cursorTarget, aiderTarget];
```

Replace with:

```ts
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import {
  type ConnectorContext,
  assertProjectRoot,
  parseBlock,
  readTargetFile,
  renderBlock,
  upsertBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import type { MemoryEntry, Project, Session } from "@megasaver/core";
import { defineCommand } from "citty";
import { invalidTargetMessage, mapErrorToCliMessage, projectNotFoundMessage } from "../errors.js";
import {
  KNOWN_TARGETS,
  KNOWN_TARGET_IDS,
  type KnownTargetId,
  isKnownTargetId,
} from "../known-targets.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";
import { projectNameSchema } from "./shared/schemas.js";
```

Notes:
- The `aiderTarget` / `codexTarget` / `cursorTarget` value imports from `@megasaver/connector-generic-cli` are no longer needed in this file because they live inside `known-targets.ts` now. The `type ConnectorTarget` import remains because the file's local helpers (e.g., `pickLatestOpenSession`, `formatStatusLine`, `buildConnectorContext`) reference the type.
- The `CLAUDE_CODE_TARGET` const, `KNOWN_TARGETS` const, `KNOWN_TARGET_IDS` const, `KnownTargetId` type, `isKnownTargetId` function, and the `// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts.` comment are all deleted (they live in `known-targets.ts`).
- `TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map((t) => t.id.length))` (later in the file) is unchanged — the imported `KNOWN_TARGETS` has the same shape.

- [ ] **Step 3: Run the affected CLI tests**

```bash
pnpm --filter @megasaver/cli exec vitest run connector connector-status
```

Expected: ALL PASS (41 connector + memory tests). Behavior is identical because:
- `KNOWN_TARGETS` import has the same elements in the same order.
- `isKnownTargetId` import has the same predicate logic.
- `KNOWN_TARGET_IDS` import is byte-identical (derived from the same `KNOWN_TARGETS`).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/connector.ts
git commit -m "refactor(cli): use known-targets in connector.ts"
```

---

## Task 4: Refactor `errors.ts` + add drift-guard tests

**Files:**
- Modify: `apps/cli/src/errors.ts`
- Modify: `apps/cli/test/errors.test.ts`

**TDD order:** add the three new failing drift-guard tests first, watch them fail (the existing `AGENT_VALUES` / `RISK_VALUES` / `KNOWN_SCOPE_IDS` constants are still in scope and produce the same strings, so the tests actually PASS without changes — this is fine, the tests are documentation of the contract). Then refactor `errors.ts` to use schema sources. Then re-run; everything still passes byte-identically. Then commit.

Because the tests pass before AND after the refactor (they assert the same string contract), this task is a "regression test + refactor" pair rather than a strict red-green-refactor cycle. The drift-guard tests' real value emerges if a future contributor widens a schema without updating consumers — they will fail then, which is the entire point.

- [ ] **Step 1: Add the three new drift-guard tests in `errors.test.ts`**

Open `apps/cli/test/errors.test.ts`. Find the existing describe block titled `"error helpers — additional coverage"` (around line 171, contains `invalidAgentMessage formats expected list of valid agents`, `invalidRiskMessage formats expected list of valid risk levels`, `invalidSessionIdMessage formats the offending value`).

Append three new `it` blocks at the end of that describe (before its closing `})`):

```ts
  it("invalidAgentMessage enumerates every agentIdSchema member", async () => {
    const { agentIdSchema } = await import("@megasaver/shared");
    const msg = invalidAgentMessage("nope").message;
    for (const m of agentIdSchema.options) expect(msg).toContain(m);
  });

  it("invalidRiskMessage enumerates every riskLevelSchema member", async () => {
    const { riskLevelSchema } = await import("@megasaver/shared");
    const msg = invalidRiskMessage("nope").message;
    for (const m of riskLevelSchema.options) expect(msg).toContain(m);
  });

  it("invalidScopeMessage enumerates every memoryScopeSchema member", async () => {
    const { memoryScopeSchema } = await import("@megasaver/core");
    const msg = invalidScopeMessage("nope").message;
    for (const m of memoryScopeSchema.options) expect(msg).toContain(m);
  });
```

Note: the third test imports `memoryScopeSchema` from `@megasaver/core`, NOT `@megasaver/shared`. (Verified during plan-writing: it lives at `packages/core/src/memory-entry.ts:4`.)

If the existing top-of-file imports do not already include `invalidScopeMessage`, add it:

```ts
import {
  invalidAgentMessage,
  invalidRiskMessage,
  invalidScopeMessage,
  invalidSessionIdMessage,
  // ... existing imports
} from "../src/errors.js";
```

- [ ] **Step 2: Run the new tests**

```bash
pnpm --filter @megasaver/cli exec vitest run errors.test
```

Expected: ALL PASS, including the three new tests. The existing pre-refactor `AGENT_VALUES` / `RISK_VALUES` / `KNOWN_SCOPE_IDS` constants happen to contain every schema member already (they were updated by Y1 + the aider slot), so the new contains-every-member assertions hold. The tests' real value is regression detection: any future schema widening that misses the consumer-side mirror (the bug class this slot kills) would now turn the matching test red.

- [ ] **Step 3: Refactor `errors.ts` to use schema-derived sources**

Open `apps/cli/src/errors.ts`. Read the current state to confirm structure:

```bash
sed -n '1,100p' apps/cli/src/errors.ts
```

Make the following changes:

(a) Update the imports at the top of `errors.ts` to include the three Zod schemas:

```ts
import { agentIdSchema, riskLevelSchema, type AgentId, type RiskLevel } from "@megasaver/shared";
import { memoryScopeSchema, type MemoryScope } from "@megasaver/core";
import { KNOWN_TARGET_IDS } from "./known-targets.js";
```

(Adjust the existing import lines: `AgentId` and `RiskLevel` may already be imported from `@megasaver/shared`; add `agentIdSchema`/`riskLevelSchema` to the same destructure. `MemoryScope` may already be imported from `@megasaver/core`; add `memoryScopeSchema` to the same destructure. The exact pre-existing import shape varies; merge into the existing imports rather than duplicating.)

(b) Delete the four constants and their "Keep in sync" comments. The exact pattern to remove (around lines 27–89):

```ts
// Keep in sync with agentIdSchema in @megasaver/shared.
// `satisfies` makes a new variant in the shared schema fail typecheck here.
const AGENT_VALUES = [
  "aider",
  "claude-code",
  "codex",
  "cursor",
  "generic-cli",
] as const satisfies readonly AgentId[];
// Keep in sync with riskLevelSchema in @megasaver/shared.
const RISK_VALUES = ["low", "medium", "high", "critical"] as const satisfies readonly RiskLevel[];
```

```ts
// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/commands/connector.ts.
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor", "aider"] as const;
// Keep in sync with memoryScopeSchema in @megasaver/core.
const KNOWN_SCOPE_IDS = ["project", "session"] as const satisfies readonly MemoryScope[];
```

(There may be additional comments above the constants — preserve any that document something other than the "keep in sync" tripwire claim.)

(c) Update every consumer of these constants. Search for occurrences:

```bash
grep -n "AGENT_VALUES\|RISK_VALUES\|KNOWN_SCOPE_IDS" apps/cli/src/errors.ts
```

For each occurrence, replace:

- `AGENT_VALUES.join(" | ")` → `agentIdSchema.options.join(" | ")`
- `AGENT_VALUES.includes(...)` → `agentIdSchema.options.includes(...)` OR `agentIdSchema.safeParse(...).success` (prefer `safeParse` for narrowing helpers; `includes` is fine for plain runtime checks). The exact choice depends on the call site — preserve the existing semantics. If a helper currently does `(AGENT_VALUES as readonly string[]).includes(value)`, change it to `(agentIdSchema.options as readonly string[]).includes(value)` to keep the same shape.
- `RISK_VALUES.join(" | ")` → `riskLevelSchema.options.join(" | ")`
- `RISK_VALUES.includes(...)` → `riskLevelSchema.options.includes(...)`
- `KNOWN_SCOPE_IDS.join(" | ")` → `memoryScopeSchema.options.join(" | ")`
- `KNOWN_SCOPE_IDS.includes(...)` → `memoryScopeSchema.options.includes(...)`

The local `KNOWN_TARGET_IDS` in `errors.ts` is no longer defined; the consumer (probably `invalidTargetMessage`) now uses the imported `KNOWN_TARGET_IDS` directly. The line:

```ts
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor", "aider"] as const;
```

is deleted. The function `invalidTargetMessage` continues to call `${KNOWN_TARGET_IDS.join(" | ")}` — the identifier now resolves to the imported value from `./known-targets.js` instead of the deleted local.

(d) If `errors.ts` exports a `KnownTargetId` type, ensure it is removed (the canonical type lives in `known-targets.ts`). Update any consumer file that imports `KnownTargetId` from `errors.ts` to import it from `./known-targets.js` instead.

- [ ] **Step 4: Run the full CLI test suite**

```bash
pnpm --filter @megasaver/cli exec vitest run
```

Expected: ALL PASS. Specifically:
- `errors.test.ts` — all original assertions pass (the strings are byte-identical: derived `agentIdSchema.options.join(" | ")` produces `aider | claude-code | codex | cursor | generic-cli`, the same string `AGENT_VALUES.join(" | ")` produced).
- `errors.test.ts` new drift-guard tests — pass.
- `session.test.ts` Y1 fix assertion (`expected: aider | claude-code | codex | cursor | generic-cli`) — passes.
- `connector.test.ts` and `connector-status.test.ts` pinned `expected: claude-code | codex | cursor | aider` — passes (KNOWN_TARGET_IDS imported from known-targets.ts produces the same launch-order string).
- `known-targets.test.ts` — passes.

Total CLI test count: 183 + 5 (known-targets) + 3 (errors drift-guards) = 191. Plus the inline `expectTypeOf` is bundled into `known-targets.test.ts`'s test count.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/errors.ts apps/cli/test/errors.test.ts
git commit -m "refactor(cli): derive errors.ts lists from schema"
```

---

## Task 5: DoD gate — `pnpm verify` + smoke + push + PR

**Files:** none modified. This is the green-bar gate.

- [ ] **Step 1: Run the full verify suite**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/closed-enum-tripwire
pnpm verify
```

Expected: ALL green. Lint clean (Biome), typecheck clean (`tsc -b --noEmit`), all tests pass. Capture the test count.

If lint fails: run `pnpm lint:fix` and re-stage; commit any auto-fixes as `chore(cli): biome auto-format`.

If typecheck fails: a likely cause is an import path error or an `as const` interaction. Re-read the failing file and confirm `KnownTargetId` resolves to the literal union (run the `known-targets.test.ts` file in isolation to verify).

If a test fails: identify whether it's:
- A pinned-string assertion that drifted because the schema member ORDER differs from the deleted constant. Recover by inspecting `agentIdSchema.options` order and aligning the test.
- A missed consumer site in `errors.ts` (one of `AGENT_VALUES.foo` / `RISK_VALUES.foo` / `KNOWN_SCOPE_IDS.foo` not converted). Search for the constant name in `errors.ts` and convert.

- [ ] **Step 2: Smoke evidence — manual error-message check**

Build the CLI and exercise each invalid-input error path to confirm the user-facing strings are byte-identical to pre-refactor behavior:

```bash
pnpm --filter @megasaver/cli build 2>&1 | tail -5

STORE=$(mktemp -d -t megasaver-tripwire-store-XXXX)
ROOT=$(mktemp -d -t megasaver-tripwire-root-XXXX)
CLI=/Users/halitozger/Desktop/MegaSaver/.worktrees/closed-enum-tripwire/apps/cli/dist/cli.js
cd "$ROOT"

node "$CLI" project create demo --store "$STORE" 2>&1
echo "--- invalid agent ---"
node "$CLI" session create demo --agent invalid-agent --store "$STORE" 2>&1
echo "--- invalid risk ---"
node "$CLI" session create demo --agent claude-code --risk invalid-risk --store "$STORE" 2>&1
echo "--- invalid scope ---"
node "$CLI" memory create demo --scope invalid-scope --content x --store "$STORE" 2>&1
echo "--- invalid target ---"
node "$CLI" connector sync demo --target invalid-target --store "$STORE" 2>&1
```

Expected outputs:

```
error: invalid agent "invalid-agent", expected: aider | claude-code | codex | cursor | generic-cli
error: invalid risk "invalid-risk", expected: low | medium | high | critical
error: invalid scope "invalid-scope", expected: project | session
error: invalid target "invalid-target", expected: claude-code | codex | cursor | aider
```

(Member orders match the schemas' declaration orders. `agentIdSchema` is alphabetic → `aider | claude-code | …`. `riskLevelSchema` is severity order → `low | medium | high | critical`. `memoryScopeSchema` is `["project", "session"]`. `KNOWN_TARGET_IDS` is launch order from `known-targets.ts`.)

If any string differs from the expected output, the schema-options order does not match the previously hard-coded order. Either update the test expectations to match the schema order (preferred — schema is the source of truth) or note the drift in the implementer's report for the controller to decide.

- [ ] **Step 3: Push the branch and open the PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/closed-enum-tripwire
git push -u origin feat/closed-enum-tripwire
```

Then create the PR via `gh`:

```bash
gh pr create --title "refactor(cli): closed-enum tripwire" --body "$(cat <<'EOF'
## Summary

Eliminates the broken `as const satisfies readonly T[]` tripwire pattern by deriving every closed-set list from a single source of truth:

- `AGENT_VALUES` → `agentIdSchema.options` (from `@megasaver/shared`)
- `RISK_VALUES` → `riskLevelSchema.options` (from `@megasaver/shared`)
- `KNOWN_SCOPE_IDS` → `memoryScopeSchema.options` (from `@megasaver/core`)
- `KNOWN_TARGET_IDS` (×2 duplicate) → derived from a new `apps/cli/src/known-targets.ts` registry

Also drops `: ConnectorTarget` annotations on `codexTarget`/`cursorTarget`/`aiderTarget` so `(typeof KNOWN_TARGETS)[number]["id"]` resolves to a true literal union for `KnownTargetId`.

Closes the bug class behind cursor PR #17 + aider PR #21 CRITICAL fix-ups (the supposed tripwire failed open because `satisfies` permits a subset; mirror constants stayed stale on schema widening).

## Behavior contract

Every CLI error message is byte-identical before and after this refactor. Manually verified end-to-end:

```
error: invalid agent "invalid-agent", expected: aider | claude-code | codex | cursor | generic-cli
error: invalid risk "invalid-risk", expected: low | medium | high | critical
error: invalid scope "invalid-scope", expected: project | session
error: invalid target "invalid-target", expected: claude-code | codex | cursor | aider
```

## Test plan

- [x] `pnpm verify` green (insert actual final test count from Step 1)
- [x] +5 runtime tests + 1 `expectTypeOf` literal-union assertion
- [x] Manual smoke: all four invalid-input error messages produce expected byte-identical strings
- [x] All pre-existing pinned-string tests pass without modification

## Spec & plan

- Spec: `docs/superpowers/specs/2026-05-09-closed-enum-tripwire-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-closed-enum-tripwire-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Replace `(insert actual final test count from Step 1)` with the actual number.)

Capture the PR URL from the `gh pr create` output.

- [ ] **Step 4: Report back**

When done, report:
- pnpm verify summary (test count, GREEN status)
- Smoke test outputs for all 4 invalid-input paths (byte-identical to pre-refactor expected)
- Push outcome
- PR URL
- Any concerns

---

## Self-Review Notes

**Spec coverage:**
- §3.1 NEW `known-targets.ts` → Task 2 creates it.
- §3.2 `targets.ts` annotation drop → Task 1.
- §3.3 `connector.ts` refactor → Task 3.
- §3.4 `errors.ts` refactor + schema imports → Task 4.
- §4 Behavior contract (byte-identical strings) → enforced by existing pinned-string tests + Task 5 manual smoke.
- §5 Test plan: §5.1 (3 errors drift-guards) → Task 4 Step 1; §5.2 (NEW known-targets.test.ts) → Task 2 Step 1; §5.3 (inline `expectTypeOf`) → Task 2 Step 1 (bundled in the same file). All tests covered.
- §6 Risk MEDIUM → full superpowers chain enforced by Task 5 (verify) + the standard PR review pipeline.
- §7 Success criteria → Task 5 verifies via `pnpm verify` + manual smoke + PR for critic re-pass.
- §8 Migration / compatibility (no migration, no public API breaking) → Task 1 confirms via existing tests; no migration tasks needed.
- §9 Out-of-scope → Tasks 1–5 strictly stay within the 4 in-scope files (`targets.ts`, `connector.ts`, `errors.ts`, `errors.test.ts`) plus the 2 new files (`known-targets.ts`, `known-targets.test.ts`).

**Placeholder scan:** No "TBD", "TODO", "fill in details". Test code is complete. Smoke commands have explicit expected output. The one place where the implementer must inspect existing code (`grep -n "AGENT_VALUES\|..."` in Task 4 Step 3 (c)) is bounded — replace each occurrence using the explicit substitution table. The "preserve existing semantics" guidance for `includes(...)` callers is bounded by the spec's safe-parse vs `.includes` decision in §3.4.

**Type consistency:** `KnownTargetId` is defined once in `known-targets.ts` (Task 2). All other tasks import it. `agentIdSchema.options` / `riskLevelSchema.options` / `memoryScopeSchema.options` are the consistent property accessors throughout. `KNOWN_TARGET_IDS` is consistently the imported derived array (Task 4 deletes the local copy, Task 3 deletes the local copy, Task 2 owns the canonical version).

**Build-order discipline:** Task 1 (annotation drop) MUST commit before Task 2 (known-targets.ts). Task 2 MUST commit before Task 3 and Task 4 (both consume the new module). Task 3 and Task 4 are independent of each other in terms of code, but Task 4's drift-guard tests are stronger evidence that the refactor is complete, so they ship after Task 3.
