# Phase 7 — Tool Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic tool router to Core — a first-class `ToolDefinition` entity (category/risk/keywords, opaque `z.unknown()` I/O schemas) plus a pure `routeToolsForTask(tools, query)` reusing `rankBm25` — via 1 entity module, 1 pure routing module, 4 `CoreRegistry` methods (`createToolDefinition`, `getToolDefinition`, `listToolDefinitions`, `routeToolsForTask`), 2 error codes, 1 MCP tool (`route_tools_for_task`, 22→23), and a `mega tools` CLI (`add/list/route/explain`). The **security half**: a tool is blocked (regardless of text relevance) when `risk === "dangerous"` OR `category ∈ {dangerous, deploy, database}`; the risk gate runs before relevance. No tool execution, no enforcement at a call site, no LLM, no embeddings.

**Architecture:** Pure functions (`isBlockedTool`, `routeToolsForTask`) hold the entire routing + risk-gating policy and unit-test without a store. Four `CoreRegistry` methods are implemented identically on the in-memory and json-directory backends; only the mutating one (`createToolDefinition`) runs under one non-re-entrant `withDirLock` in the json impl — `getToolDefinition`/`listToolDefinitions`/`routeToolsForTask` are pure reads with no lock. The MCP tool and CLI commands are thin handlers, mirroring Phases 4–6. Registration is CLI-only; the only wire tool is `route_tools_for_task`.

**Tech Stack:** TypeScript (strict ESM, `exactOptionalPropertyTypes`), zod, vitest, citty (CLI), `@modelcontextprotocol/sdk`, pnpm + turbo, biome. `rankBm25` from `@megasaver/retrieval` (already a core dep).

**Spec:** `docs/superpowers/specs/2026-06-12-phase7-tool-router-design.md`
**Working dir:** `.worktrees/phase7-router` (branch `feat/phase7-tool-router`, off `main` @ Phase 6).

**Test commands:** per-package `pnpm --filter @megasaver/<pkg> test <pattern>`; type `pnpm --filter @megasaver/<pkg> typecheck`. Final gate: `pnpm verify` (= `pnpm lint && pnpm typecheck && pnpm test && pnpm conventions:check`; lint is `biome check .` over the whole repo — run it, the per-package turbo lint misses repo-wide format/import-sort). Run `biome check --write` on new files before committing so lint stays clean. Workspace packages resolve to built `dist/`; if a dependent test fails on an unresolved `@megasaver/*` import, build that dep first (`pnpm --filter @megasaver/<dep> build`).

---

## File Structure

**Modify (shared):**
- `packages/shared/src/ids.ts` — `toolDefinitionIdSchema`, `ToolDefinitionId`

**Create (core):**
- `packages/core/src/tool-definition.ts` — entity + enums + create-input schema
- `packages/core/src/tool-router.ts` — pure `isBlockedTool` + `routeToolsForTask`
- `packages/core/test/tool-definition-schema.test.ts`
- `packages/core/test/tool-router.test.ts`
- `packages/core/test/registry-tools.test.ts` — registry methods (both impls)

**Modify (core):**
- `packages/core/src/errors.ts` — 2 new codes
- `packages/core/src/json-directory-store.ts` — `toolDefinitionsDir` + read/write helpers
- `packages/core/src/registry.ts` — interface + in-memory impl + `buildToolDefinitionFromInput`
- `packages/core/src/json-directory-registry.ts` — json impl
- `packages/core/src/index.ts` — barrel exports
- `packages/core/test/errors-tools.test.ts` (create)

**Create (mcp-bridge):**
- `packages/mcp-bridge/src/tools/route-tools-for-task.ts`
- `packages/mcp-bridge/test/tools/route-tools-for-task.test.ts`

**Modify (mcp-bridge):**
- `packages/mcp-bridge/src/tool-name.ts` (22→23) + `test/tool-name.test-d.ts`
- `packages/mcp-bridge/src/server.ts`
- `packages/mcp-bridge/test/server.e2e.test.ts`

**Create (cli):** `apps/cli/src/commands/tools/{index,add,list,route,explain,shared}.ts` + `apps/cli/test/tools.test.ts`.
**Modify (cli):** `apps/cli/src/main.ts`.

**Create (release):** `.changeset/phase7-tool-router.md`.

---

## Task 1: Branded id — ToolDefinitionId

**Files:**
- Modify: `packages/shared/src/ids.ts` (append)
- Test: `packages/core/test/tool-definition-schema.test.ts` (created here; extended in Task 3)

- [ ] **Step 1: Write the failing test** (`packages/core/test/tool-definition-schema.test.ts`)

```ts
import { toolDefinitionIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";

describe("tool definition id", () => {
  it("brands a lowercase uuid as ToolDefinitionId", () => {
    const id = toolDefinitionIdSchema.parse("e0000000-0000-4000-8000-000000000001");
    expect(id).toBe("e0000000-0000-4000-8000-000000000001");
  });
  it("rejects an uppercase uuid", () => {
    expect(() => toolDefinitionIdSchema.parse("E0000000-0000-4000-8000-000000000001")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test tool-definition-schema`
Expected: FAIL — `toolDefinitionIdSchema` not exported. (Build shared first if `@megasaver/shared` won't resolve: `pnpm --filter @megasaver/shared build`.)

- [ ] **Step 3: Append to `packages/shared/src/ids.ts`** (after the `taskStepIdSchema` block):

```ts
export const toolDefinitionIdSchema = lowercaseUuid.brand<"ToolDefinitionId">();
export type ToolDefinitionId = z.infer<typeof toolDefinitionIdSchema>;
```

- [ ] **Step 4: Build shared + run test to verify it passes**

Run: `pnpm --filter @megasaver/shared build && pnpm --filter @megasaver/core test tool-definition-schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ids.ts packages/core/test/tool-definition-schema.test.ts
git commit -m "feat(shared): add ToolDefinitionId brand"
```

---

## Task 2: Registry error codes

**Files:**
- Modify: `packages/core/src/errors.ts` (the `coreRegistryErrorCodeSchema` enum)
- Test: `packages/core/test/errors-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 7 registry error codes", () => {
  it("includes the two tool-definition codes", () => {
    for (const code of [
      "tool_definition_already_exists",
      "tool_definition_not_found",
    ] as const) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test errors-tools`
Expected: FAIL.

- [ ] **Step 3: Append the codes** as the last members of `coreRegistryErrorCodeSchema` in `packages/core/src/errors.ts`, after `"task_step_dependency_unmet",`:

```ts
  "tool_definition_already_exists",
  "tool_definition_not_found",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test errors-tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/test/errors-tools.test.ts
git commit -m "feat(core): Phase 7 tool-router registry error codes"
```

---

## Task 3: Entity module — tool-definition.ts (enums, schema, create-input)

**Files:**
- Create: `packages/core/src/tool-definition.ts`
- Test: `packages/core/test/tool-definition-schema.test.ts` (append to the file from Task 1)

- [ ] **Step 1: Append the failing test**

Add imports at the top of `tool-definition-schema.test.ts`:

```ts
import {
  toolCategorySchema,
  toolDefinitionInputSchema,
  toolDefinitionSchema,
  toolRiskSchema,
} from "../src/tool-definition.js";
```

Then append:

```ts
const VALID = {
  id: "e0000000-0000-4000-8000-000000000001",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "rg",
  description: "ripgrep search across the repo",
  category: "search",
  risk: "safe",
  inputSchema: null,
  outputSchema: null,
  keywords: ["search", "grep"],
  createdAt: "2026-06-12T00:00:00.000Z",
} as const;

describe("toolCategorySchema / toolRiskSchema", () => {
  it("preserves the 9-member category declaration order", () => {
    expect(toolCategorySchema.options).toEqual([
      "filesystem",
      "search",
      "git",
      "test",
      "package",
      "database",
      "deploy",
      "browser",
      "dangerous",
    ]);
  });
  it("preserves the 3-member risk declaration order", () => {
    expect(toolRiskSchema.options).toEqual(["safe", "medium", "dangerous"]);
  });
});

describe("toolDefinitionSchema", () => {
  it("parses a valid tool definition", () => {
    const parsed = toolDefinitionSchema.parse(VALID);
    expect(parsed.name).toBe("rg");
    expect(parsed.keywords).toEqual(["search", "grep"]);
  });
  it("normalizes keywords (lowercase, trim, de-dup, drop empties)", () => {
    const parsed = toolDefinitionSchema.parse({
      ...VALID,
      keywords: ["  Grep ", "grep", "", "Search"],
    });
    expect(parsed.keywords).toEqual(["grep", "search"]);
  });
  it("round-trips an opaque inputSchema unchanged", () => {
    const inputSchema = { type: "object", properties: { q: { type: "string" } } };
    const parsed = toolDefinitionSchema.parse({ ...VALID, inputSchema });
    expect(parsed.inputSchema).toEqual(inputSchema);
  });
  it("rejects an unknown category", () => {
    expect(() => toolDefinitionSchema.parse({ ...VALID, category: "network" })).toThrow();
  });
  it("rejects an unknown risk", () => {
    expect(() => toolDefinitionSchema.parse({ ...VALID, risk: "high" })).toThrow();
  });
  it("rejects an unknown key (strict)", () => {
    expect(() => toolDefinitionSchema.parse({ ...VALID, extra: 1 })).toThrow();
  });
});

describe("toolDefinitionInputSchema", () => {
  it("defaults keywords to [] and accepts optional opaque schemas", () => {
    const parsed = toolDefinitionInputSchema.parse({
      name: "git-commit",
      description: "stage and commit",
      category: "git",
      risk: "medium",
    });
    expect(parsed.keywords).toEqual([]);
    expect(parsed.inputSchema).toBeUndefined();
  });
  it("rejects an unknown key (strict)", () => {
    expect(() =>
      toolDefinitionInputSchema.parse({
        name: "x",
        description: "x",
        category: "git",
        risk: "safe",
        extra: 1,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test tool-definition-schema`
Expected: FAIL — `tool-definition.js` not found.

- [ ] **Step 3: Create `packages/core/src/tool-definition.ts`**

```ts
import { projectIdSchema, titleSchema, toolDefinitionIdSchema } from "@megasaver/shared";
import { z } from "zod";

// Order: roadmap declaration order (Phase 7). Functional grouping of what a
// tool touches; the last three (database, deploy, dangerous) are the
// blocked-by-category set (see tool-router.ts). AA3: declaration order is a contract.
export const toolCategorySchema = z.enum([
  "filesystem",
  "search",
  "git",
  "test",
  "package",
  "database",
  "deploy",
  "browser",
  "dangerous",
]);
export type ToolCategory = z.infer<typeof toolCategorySchema>;

// Order: ascending blast radius (safe < medium < dangerous). AA3.
export const toolRiskSchema = z.enum(["safe", "medium", "dangerous"]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;

// Keywords are a retrieval surface (BM25 over name+description+keywords), so
// they are normalized exactly like memory-entry keywords: lowercased, trimmed,
// de-duplicated, empties dropped. Order of first appearance is preserved.
const toolKeywordsSchema = z.array(z.string()).transform((raw) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
});

export const toolDefinitionSchema = z
  .object({
    id: toolDefinitionIdSchema,
    projectId: projectIdSchema,
    name: titleSchema,
    description: z.string().trim().min(1),
    category: toolCategorySchema,
    risk: toolRiskSchema,
    // Opaque, descriptive only — the router never reads or executes these.
    // z.unknown() so any JSON-shaped value round-trips through the store
    // without the engine taking a dependency on a tool's I/O contract.
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    keywords: toolKeywordsSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

// Caller-supplied tool metadata: the fields the agent/developer writes.
// id/createdAt are engine-owned; inputSchema/outputSchema are optional opaque
// JSON defaulted to null by buildToolDefinitionFromInput.
export const toolDefinitionInputSchema = z
  .object({
    name: titleSchema,
    description: z.string().trim().min(1),
    category: toolCategorySchema,
    risk: toolRiskSchema,
    keywords: z.array(z.string()).default([]),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
  })
  .strict();

export type ToolDefinitionInput = z.infer<typeof toolDefinitionInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test tool-definition-schema`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add packages/core/src/tool-definition.ts packages/core/test/tool-definition-schema.test.ts
git commit -m "feat(core): ToolDefinition entity, category/risk enums, create-input"
```

---

## Task 4: Pure routing module — tool-router.ts

**Files:**
- Create: `packages/core/src/tool-router.ts`
- Test: `packages/core/test/tool-router.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../src/tool-definition.js";
import { isBlockedTool, routeToolsForTask } from "../src/tool-router.js";

let seq = 0;
function tool(over: Partial<ToolDefinition>): ToolDefinition {
  seq += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}` as ToolDefinition["id"],
    projectId: "11111111-1111-4111-8111-111111111111" as ToolDefinition["projectId"],
    name: "tool",
    description: "a tool",
    category: "search",
    risk: "safe",
    inputSchema: null,
    outputSchema: null,
    keywords: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    ...over,
  };
}

describe("isBlockedTool", () => {
  it("blocks risk=dangerous in any category", () => {
    expect(isBlockedTool(tool({ category: "search", risk: "dangerous" }))).toBe(true);
  });
  it("blocks category dangerous/deploy/database regardless of risk", () => {
    expect(isBlockedTool(tool({ category: "dangerous", risk: "safe" }))).toBe(true);
    expect(isBlockedTool(tool({ category: "deploy", risk: "safe" }))).toBe(true);
    expect(isBlockedTool(tool({ category: "database", risk: "medium" }))).toBe(true);
  });
  it("does not block safe/medium tools in the six routable categories", () => {
    for (const category of ["filesystem", "search", "git", "test", "package", "browser"] as const) {
      expect(isBlockedTool(tool({ category, risk: "safe" }))).toBe(false);
      expect(isBlockedTool(tool({ category, risk: "medium" }))).toBe(false);
    }
  });
});

describe("routeToolsForTask", () => {
  it("with no task, allows all non-blocked tools and lists the blocked ones", () => {
    const grep = tool({ name: "grep", category: "search" });
    const deploy = tool({ name: "ship", category: "deploy" });
    const res = routeToolsForTask([grep, deploy], undefined);
    expect(res.allowedTools.map((t) => t.id)).toEqual([grep.id]);
    expect(res.blockedTools.map((t) => t.id)).toEqual([deploy.id]);
    expect(res.reason).toBe(
      "no task filter — 1 safe tool(s) allowed; 1 blocked as dangerous/deploy/database",
    );
  });

  it("with a task, allows only score>0 non-blocked tools by descending score", () => {
    const grep = tool({ name: "grep", description: "search files for a pattern", keywords: ["search"] });
    const fmt = tool({ name: "prettier", description: "format code", category: "package" });
    const res = routeToolsForTask([grep, fmt], "search files for the login pattern");
    expect(res.allowedTools.map((t) => t.id)).toEqual([grep.id]);
    // fmt is non-blocked but irrelevant (score 0): omitted from BOTH lists.
    expect(res.blockedTools).toEqual([]);
    expect(res.reason).toBe(
      "1 tool(s) matched 'search files for the login pattern'; 0 blocked as dangerous/deploy/database; 1 not relevant",
    );
  });

  it("NEVER promotes a dangerous tool into allowedTools even on a strong text match", () => {
    const dropDb = tool({
      name: "drop-database",
      description: "drop the production database immediately",
      category: "database",
      risk: "dangerous",
      keywords: ["database", "drop"],
    });
    const res = routeToolsForTask([dropDb], "drop the production database");
    expect(res.allowedTools).toEqual([]);
    expect(res.blockedTools.map((t) => t.id)).toEqual([dropDb.id]);
    expect(res.reason).toBe(
      "no tools matched 'drop the production database'; 1 blocked as dangerous/deploy/database; 0 not relevant",
    );
  });

  it("breaks score ties by id and is stable", () => {
    const a = tool({ id: "e0000000-0000-4000-8000-0000000000a1" as ToolDefinition["id"], name: "alpha", description: "same words here", keywords: [] });
    const b = tool({ id: "e0000000-0000-4000-8000-0000000000b2" as ToolDefinition["id"], name: "beta", description: "same words here", keywords: [] });
    const res = routeToolsForTask([b, a], "same words here");
    expect(res.allowedTools.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("empty tool set yields empty lists", () => {
    const res = routeToolsForTask([], "anything");
    expect(res.allowedTools).toEqual([]);
    expect(res.blockedTools).toEqual([]);
    expect(res.reason).toBe(
      "no tools matched 'anything'; 0 blocked as dangerous/deploy/database; 0 not relevant",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test tool-router`
Expected: FAIL — `tool-router.js` not found.

- [ ] **Step 3: Create `packages/core/src/tool-router.ts`**

```ts
import { rankBm25 } from "@megasaver/retrieval";
import type { ToolDefinition } from "./tool-definition.js";
import type { ToolCategory } from "./tool-definition.js";

export type ToolRouteResult = {
  allowedTools: ToolDefinition[];
  blockedTools: ToolDefinition[];
  reason: string;
};

// SECURITY-CRITICAL set: tools in these categories never enter allowedTools
// from a plain task route, regardless of text relevance. deploy mutates
// running/production infrastructure; database mutates persistent stores; both
// have catastrophic, often irreversible blast radii, so a BM25 text match is
// never treated as consent. `dangerous` is the explicit destructive label and
// is blocked by category as a redundant guard against a mis-set `risk`.
const BLOCKED_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([
  "dangerous",
  "deploy",
  "database",
]);

// A tool is blocked iff its risk is dangerous OR its category is in the blocked
// set. Total: every tool is classified by this single boolean, gate runs before
// relevance (see routeToolsForTask).
export function isBlockedTool(tool: ToolDefinition): boolean {
  return tool.risk === "dangerous" || BLOCKED_CATEGORIES.has(tool.category);
}

const BLOCKED_SUFFIX = "blocked as dangerous/deploy/database";

// Deterministic recommender. Stage 1 (security gate): split into blocked vs
// candidate by isBlockedTool — blocked tools can NEVER reach allowedTools.
// Stage 2 (relevance): among candidates only, no/blank query => all candidates
// allowed; else BM25 over name+description+keywords, score>0 => allowed
// (descending score, id tiebreak), score<=0 => omitted from BOTH lists
// (irrelevant, not forbidden). No LLM. Stable order.
export function routeToolsForTask(
  tools: readonly ToolDefinition[],
  query: string | undefined,
): ToolRouteResult {
  const blockedTools = tools
    .filter(isBlockedTool)
    .sort((a, b) => a.id.localeCompare(b.id));
  const candidates = tools.filter((tool) => !isBlockedTool(tool));

  const text = query?.trim();
  const hasText = text !== undefined && text.length > 0;

  if (!hasText) {
    const allowedTools = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
    return {
      allowedTools,
      blockedTools,
      reason: `no task filter — ${allowedTools.length} safe tool(s) allowed; ${blockedTools.length} ${BLOCKED_SUFFIX}`,
    };
  }

  const documents = candidates.map((tool) => ({
    id: tool.id,
    text: `${tool.name} ${tool.description} ${tool.keywords.join(" ")}`,
  }));
  const scoreById = new Map<string, number>();
  for (const hit of rankBm25({ query: text, documents, topN: candidates.length })) {
    if (hit.score > 0) scoreById.set(hit.id, hit.score);
  }

  const allowedTools = candidates
    .filter((tool) => scoreById.has(tool.id))
    .sort(
      (a, b) =>
        (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0) || a.id.localeCompare(b.id),
    );

  const notRelevant = candidates.length - allowedTools.length;
  const head =
    allowedTools.length > 0
      ? `${allowedTools.length} tool(s) matched '${text}'`
      : `no tools matched '${text}'`;
  return {
    allowedTools,
    blockedTools,
    reason: `${head}; ${blockedTools.length} ${BLOCKED_SUFFIX}; ${notRelevant} not relevant`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test tool-router`
Expected: PASS. (If `@megasaver/retrieval` won't resolve, build it: `pnpm --filter @megasaver/retrieval build`.)

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add packages/core/src/tool-router.ts packages/core/test/tool-router.test.ts
git commit -m "feat(core): pure tool router — risk gate before BM25 relevance"
```

---

## Task 5: Store helpers — tool-definitions JSONL

**Files:**
- Modify: `packages/core/src/json-directory-store.ts`
- Test: `packages/core/test/store-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readToolDefinitionsForProject,
  resolveStorePaths,
  writeToolDefinitionsForProject,
} from "../src/json-directory-store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ToolDefinition["projectId"];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-tools-store-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const TOOL: ToolDefinition = {
  id: "e0000000-0000-4000-8000-000000000001" as ToolDefinition["id"],
  projectId: PROJECT_ID,
  name: "rg",
  description: "ripgrep",
  category: "search",
  risk: "safe",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
  outputSchema: null,
  keywords: ["search"],
  createdAt: "2026-06-12T00:00:00.000Z",
};

describe("tool-definitions store round-trip", () => {
  it("writes then reads back, preserving an opaque inputSchema", () => {
    const paths = resolveStorePaths(root);
    writeToolDefinitionsForProject(paths, PROJECT_ID, [TOOL]);
    const read = readToolDefinitionsForProject(paths, PROJECT_ID);
    expect(read).toEqual([TOOL]);
    expect(read[0]?.inputSchema).toEqual(TOOL.inputSchema);
  });
  it("empty set removes the file (reads back as empty)", () => {
    const paths = resolveStorePaths(root);
    writeToolDefinitionsForProject(paths, PROJECT_ID, [TOOL]);
    writeToolDefinitionsForProject(paths, PROJECT_ID, []);
    expect(readToolDefinitionsForProject(paths, PROJECT_ID)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test store-tools`
Expected: FAIL — helpers + `toolDefinitionsDir` missing.

- [ ] **Step 3a: Add the import** in `packages/core/src/json-directory-store.ts` (with the other entity imports, after the `task-plan` import):

```ts
import { type ToolDefinition, toolDefinitionSchema } from "./tool-definition.js";
```

- [ ] **Step 3b: Add `toolDefinitionsDir` to `StorePaths`** (after `taskPlansDir`):

```ts
  taskPlansDir: string;
  toolDefinitionsDir: string;
```

- [ ] **Step 3c: Add `toolDefinitionsDir` to BOTH return objects** in `resolveStorePaths` (the ENOENT branch and the normal branch), after each `taskPlansDir: join(resolvedRootDir, "task-plans"),`:

```ts
        toolDefinitionsDir: join(resolvedRootDir, "tool-definitions"),
```
(ENOENT branch — note the 8-space indent) and
```ts
    toolDefinitionsDir: join(resolvedRootDir, "tool-definitions"),
```
(normal branch — 4-space indent).

- [ ] **Step 3d: Add the read/write helpers** (after `writeTaskPlansForProject`, before the `removeIfExists` helper):

```ts
export function readToolDefinitionsForProject(
  paths: StorePaths,
  projectId: ProjectId,
): ToolDefinition[] {
  const filePath = join(paths.toolDefinitionsDir, `${projectId}.jsonl`);
  return readJsonLines(filePath).map((entry) =>
    parseEntity(toolDefinitionSchema, entry, filePath),
  );
}

export function readAllToolDefinitions(paths: StorePaths): ToolDefinition[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(paths.toolDefinitionsDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath: paths.toolDefinitionsDir,
      cause: error,
    });
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .flatMap((fileName) => {
      const filePath = join(paths.toolDefinitionsDir, fileName);
      return readJsonLines(filePath).map((entry) =>
        parseEntity(toolDefinitionSchema, entry, filePath),
      );
    });
}

export function writeToolDefinitionsForProject(
  paths: StorePaths,
  projectId: ProjectId,
  tools: readonly ToolDefinition[],
): void {
  const filePath = join(paths.toolDefinitionsDir, `${projectId}.jsonl`);
  if (tools.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${tools.map((t) => JSON.stringify(t)).join("\n")}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test store-tools`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add packages/core/src/json-directory-store.ts packages/core/test/store-tools.test.ts
git commit -m "feat(core): per-project tool-definitions JSONL store helpers"
```

---

## Task 6: Registry methods (interface + both impls)

**Files:**
- Modify: `packages/core/src/registry.ts` (interface, `buildToolDefinitionFromInput`, in-memory impl)
- Modify: `packages/core/src/json-directory-registry.ts` (json impl)
- Test: `packages/core/test/registry-tools.test.ts`

> **Critical (json impl):** `createToolDefinition` does its read-dup-check-write INLINE under one `withDirLock`; the other three methods are pure reads with no lock. `routeToolsForTask` delegates to the pure `routeToolsForTask(tools, query)` from `tool-router.ts` — alias the import to avoid the name clash with the registry method, exactly as `searchFailedAttempts as searchFailures` is aliased.

- [ ] **Step 1: Write the failing test** (shared suite over both impls)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CoreRegistry,
  type ToolDefinitionInput,
  createInMemoryCoreRegistry,
  createJsonDirectoryCoreRegistry,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;

function clockFrom(ids: string[]): { now: () => string; newId: () => string } {
  let i = 0;
  return { now: () => "2026-06-12T00:00:00.000Z", newId: () => ids[i++] ?? "overflow" };
}

const GREP: ToolDefinitionInput = {
  name: "grep",
  description: "search files for a pattern",
  category: "search",
  risk: "safe",
  keywords: ["search"],
} as ToolDefinitionInput;

const SHIP: ToolDefinitionInput = {
  name: "ship",
  description: "deploy to production",
  category: "deploy",
  risk: "dangerous",
  keywords: ["deploy"],
} as ToolDefinitionInput;

const TOOL_ID = "e0000000-0000-4000-8000-000000000001";
const SHIP_ID = "e0000000-0000-4000-8000-000000000002";

const tmpRoots: string[] = [];
afterEach(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  tmpRoots.length = 0;
});

function backends(): { name: string; make: () => CoreRegistry }[] {
  return [
    { name: "in-memory", make: () => createInMemoryCoreRegistry() },
    {
      name: "json-directory",
      make: () => {
        const root = mkdtempSync(join(tmpdir(), "mega-tools-reg-"));
        tmpRoots.push(root);
        return createJsonDirectoryCoreRegistry({ rootDir: root });
      },
    },
  ];
}

function seedProject(registry: CoreRegistry): void {
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as Parameters<CoreRegistry["createProject"]>[0]);
}

describe.each(backends())("$name registry — tool definitions", ({ make }) => {
  it("createToolDefinition mints id + createdAt, defaults opaque schemas to null", () => {
    const registry = make();
    seedProject(registry);
    const created = registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    expect(created.id).toBe(TOOL_ID);
    expect(created.createdAt).toBe("2026-06-12T00:00:00.000Z");
    expect(created.inputSchema).toBeNull();
    expect(created.outputSchema).toBeNull();
    expect(registry.getToolDefinition(created.id)).toEqual(created);
  });

  it("createToolDefinition requires the project", () => {
    const registry = make();
    expect(() => registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]))).toThrow(
      /project_not_found|does not exist/,
    );
  });

  it("createToolDefinition rejects a duplicate id", () => {
    const registry = make();
    seedProject(registry);
    registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    expect(() => registry.createToolDefinition(PROJECT_ID, SHIP, clockFrom([TOOL_ID]))).toThrow(
      /tool_definition_already_exists|already exists/,
    );
  });

  it("listToolDefinitions is project-scoped", () => {
    const registry = make();
    seedProject(registry);
    registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    expect(registry.listToolDefinitions(PROJECT_ID).map((t) => t.id)).toEqual([TOOL_ID]);
  });

  it("getToolDefinition returns null on miss", () => {
    const registry = make();
    expect(registry.getToolDefinition(TOOL_ID as never)).toBeNull();
  });

  it("routeToolsForTask gates dangerous tools and ranks the rest", () => {
    const registry = make();
    seedProject(registry);
    registry.createToolDefinition(PROJECT_ID, GREP, clockFrom([TOOL_ID]));
    registry.createToolDefinition(PROJECT_ID, SHIP, clockFrom([SHIP_ID]));
    const res = registry.routeToolsForTask(PROJECT_ID, "search files");
    expect(res.allowedTools.map((t) => t.id)).toEqual([TOOL_ID]);
    expect(res.blockedTools.map((t) => t.id)).toEqual([SHIP_ID]);
    expect(res.reason).toContain("blocked as dangerous/deploy/database");
  });

  it("routeToolsForTask requires the project", () => {
    const registry = make();
    expect(() => registry.routeToolsForTask(PROJECT_ID, "x")).toThrow(
      /project_not_found|does not exist/,
    );
  });
});
```

(The `Project` create shape is `{ id, name, rootPath, createdAt, updatedAt }` — confirmed against `packages/core/src/project.ts`. The cast `as Parameters<...>[0]` keeps the seed resilient if a field is added.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test registry-tools`
Expected: FAIL — methods missing.

- [ ] **Step 3a: `packages/core/src/registry.ts` — add imports** (with the other entity imports):

```ts
import { type ToolRouteResult, routeToolsForTask as routeTools } from "./tool-router.js";
import {
  type ToolDefinition,
  type ToolDefinitionInput,
  toolDefinitionInputSchema,
  toolDefinitionSchema,
} from "./tool-definition.js";
```

And widen the `@megasaver/shared` id import to include `ToolDefinitionId`:

```ts
import type {
  FailedAttemptId,
  MemoryEntryId,
  ProjectId,
  ProjectRuleId,
  SessionId,
  TaskPlanId,
  TaskStepId,
  ToolDefinitionId,
} from "@megasaver/shared";
```

- [ ] **Step 3b: Add the four methods to the `CoreRegistry` interface** (after `retryTaskStep`):

```ts
  createToolDefinition(
    projectId: ProjectId,
    input: ToolDefinitionInput,
    clock: { now: () => string; newId: () => string },
  ): ToolDefinition;
  getToolDefinition(id: ToolDefinitionId): ToolDefinition | null;
  listToolDefinitions(projectId: ProjectId): ToolDefinition[];
  routeToolsForTask(projectId: ProjectId, query: string | undefined): ToolRouteResult;
```

- [ ] **Step 3c: Add the shared builder** (after `buildTaskPlanFromInput`, before the in-memory impl):

```ts
// Resolve a caller-authored ToolDefinitionInput into a fully-formed
// ToolDefinition: mint the id, stamp createdAt, default opaque I/O schemas to
// null. Shared verbatim by both registry impls so they stay behaviourally
// identical.
export function buildToolDefinitionFromInput(
  projectId: ProjectId,
  input: ToolDefinitionInput,
  clock: { now: () => string; newId: () => string },
): ToolDefinition {
  const parsed = toolDefinitionInputSchema.parse(input);
  return toolDefinitionSchema.parse({
    id: clock.newId(),
    projectId,
    name: parsed.name,
    description: parsed.description,
    category: parsed.category,
    risk: parsed.risk,
    keywords: parsed.keywords,
    inputSchema: parsed.inputSchema ?? null,
    outputSchema: parsed.outputSchema ?? null,
    createdAt: clock.now(),
  });
}
```

- [ ] **Step 3d: In-memory impl** — add a map declaration with the others:

```ts
  const toolDefinitions = new Map<ToolDefinitionId, ToolDefinition>();
```

and add the four methods to the returned object (after `retryTaskStep`):

```ts
    createToolDefinition(projectId, input, clock) {
      requireProject(projectId);
      const tool = buildToolDefinitionFromInput(projectId, input, clock);
      if (toolDefinitions.has(tool.id)) {
        throw new CoreRegistryError(
          "tool_definition_already_exists",
          `Tool definition already exists: ${tool.id}`,
        );
      }
      toolDefinitions.set(tool.id, tool);
      return toolDefinitionSchema.parse(tool);
    },

    getToolDefinition(id) {
      const tool = toolDefinitions.get(id);
      return tool ? toolDefinitionSchema.parse(tool) : null;
    },

    listToolDefinitions(projectId) {
      requireProject(projectId);
      return Array.from(toolDefinitions.values())
        .filter((t) => t.projectId === projectId)
        .map((t) => toolDefinitionSchema.parse(t));
    },

    routeToolsForTask(projectId, query) {
      requireProject(projectId);
      const tools = Array.from(toolDefinitions.values())
        .filter((t) => t.projectId === projectId)
        .map((t) => toolDefinitionSchema.parse(t));
      return routeTools(tools, query);
    },
```

- [ ] **Step 3e: `packages/core/src/json-directory-registry.ts` — add imports.** Widen the `@megasaver/shared` id import to add `ToolDefinitionId`, add to the `json-directory-store` import group:

```ts
  readAllToolDefinitions,
  readToolDefinitionsForProject,
  writeToolDefinitionsForProject,
```

add the registry-helper import (with `buildTaskPlanFromInput` etc.):

```ts
import {
  type CoreRegistry,
  applyTaskStepRecord,
  applyTaskStepRetry,
  buildTaskPlanFromInput,
  buildToolDefinitionFromInput,
} from "./registry.js";
```

and add:

```ts
import { routeToolsForTask as routeTools } from "./tool-router.js";
import { toolDefinitionSchema } from "./tool-definition.js";
```

- [ ] **Step 3f: json impl** — add the four methods to the returned object (after `retryTaskStep`):

```ts
    createToolDefinition(projectId, input, clock) {
      return withDirLock(options.rootDir, () => {
        requireProject(projectId);
        const tool = buildToolDefinitionFromInput(projectId, input, clock);
        if (readAllToolDefinitions(paths).some((t) => t.id === tool.id)) {
          throw new CoreRegistryError(
            "tool_definition_already_exists",
            `Tool definition already exists: ${tool.id}`,
          );
        }
        writeToolDefinitionsForProject(paths, projectId, [
          ...readToolDefinitionsForProject(paths, projectId),
          tool,
        ]);
        return toolDefinitionSchema.parse(tool);
      });
    },

    getToolDefinition(id) {
      const tool = readAllToolDefinitions(paths).find((t) => t.id === id);
      return tool ? toolDefinitionSchema.parse(tool) : null;
    },

    listToolDefinitions(projectId) {
      requireProject(projectId);
      return readToolDefinitionsForProject(paths, projectId).map((t) =>
        toolDefinitionSchema.parse(t),
      );
    },

    routeToolsForTask(projectId, query) {
      requireProject(projectId);
      const tools = readToolDefinitionsForProject(paths, projectId).map((t) =>
        toolDefinitionSchema.parse(t),
      );
      return routeTools(tools, query);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test registry-tools`
Expected: PASS (both backends).

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add packages/core/src/registry.ts packages/core/src/json-directory-registry.ts packages/core/test/registry-tools.test.ts
git commit -m "feat(core): tool-definition registry methods (both impls)"
```

---

## Task 7: Core barrel exports

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/exports-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("Phase 7 public surface", () => {
  it("exports the tool-router entity, enums, pure fns, and types", () => {
    expect(typeof core.toolDefinitionSchema.parse).toBe("function");
    expect(typeof core.toolDefinitionInputSchema.parse).toBe("function");
    expect(core.toolCategorySchema.options).toContain("deploy");
    expect(core.toolRiskSchema.options).toContain("dangerous");
    expect(typeof core.isBlockedTool).toBe("function");
    expect(typeof core.routeToolsForTask).toBe("function");
    expect(typeof core.buildToolDefinitionFromInput).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test exports-tools`
Expected: FAIL — `tool-definition` / `tool-router` not re-exported.

- [ ] **Step 3: Add the two re-exports** at the top of `packages/core/src/index.ts` (with the other `export *` lines):

```ts
export * from "./tool-definition.js";
export * from "./tool-router.js";
```

- [ ] **Step 4: Build core + run test to verify it passes**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/core test exports-tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/exports-tools.test.ts
git commit -m "feat(core): export ToolDefinition + tool-router public surface"
```

---

## Task 8: MCP tool — route_tools_for_task

**Files:**
- Create: `packages/mcp-bridge/src/tools/route-tools-for-task.ts`
- Test: `packages/mcp-bridge/test/tools/route-tools-for-task.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {
  type CoreRegistry,
  type ToolDefinitionInput,
  createInMemoryCoreRegistry,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleRouteToolsForTask } from "../../src/tools/route-tools-for-task.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function seeded(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID as ProjectId,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as Parameters<CoreRegistry["createProject"]>[0]);
  const clock = (id: string) => ({ now: () => "2026-06-12T00:00:00.000Z", newId: () => id });
  registry.createToolDefinition(
    PROJECT_ID as ProjectId,
    { name: "grep", description: "search files", category: "search", risk: "safe", keywords: ["search"] } as ToolDefinitionInput,
    clock("e0000000-0000-4000-8000-000000000001"),
  );
  registry.createToolDefinition(
    PROJECT_ID as ProjectId,
    { name: "ship", description: "deploy to production", category: "deploy", risk: "dangerous", keywords: ["deploy"] } as ToolDefinitionInput,
    clock("e0000000-0000-4000-8000-000000000002"),
  );
  return registry;
}

describe("handleRouteToolsForTask", () => {
  it("returns allowed + blocked + reason for a task", async () => {
    const res = await handleRouteToolsForTask({ registry: seeded() }, {
      projectId: PROJECT_ID,
      task: "search files",
    });
    expect(res.allowedTools.map((t) => t.name)).toEqual(["grep"]);
    expect(res.blockedTools.map((t) => t.name)).toEqual(["ship"]);
    expect(res.reason).toContain("blocked as dangerous/deploy/database");
  });

  it("allows all safe tools when no task is given", async () => {
    const res = await handleRouteToolsForTask({ registry: seeded() }, { projectId: PROJECT_ID });
    expect(res.allowedTools.map((t) => t.name)).toEqual(["grep"]);
    expect(res.blockedTools.map((t) => t.name)).toEqual(["ship"]);
  });

  it("maps unknown project to resource_not_found", async () => {
    await expect(
      handleRouteToolsForTask({ registry: createInMemoryCoreRegistry() }, {
        projectId: PROJECT_ID,
        task: "x",
      }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("rejects bad input with validation_failed", async () => {
    await expect(
      handleRouteToolsForTask({ registry: seeded() }, { task: 5 }),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test route-tools-for-task`
Expected: FAIL — handler not found.

- [ ] **Step 3: Create `packages/mcp-bridge/src/tools/route-tools-for-task.ts`**

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type ToolRouteResult,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RouteToolsForTaskEnv = { registry: CoreRegistry };

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().optional(),
  })
  .strict();

export type RouteToolsForTaskResult = ToolRouteResult;

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "project_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "route_tools_for_task failed");
}

export async function handleRouteToolsForTask(
  env: RouteToolsForTaskEnv,
  rawArgs: unknown,
): Promise<RouteToolsForTaskResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  try {
    return env.registry.routeToolsForTask(parsed.data.projectId as ProjectId, parsed.data.task);
  } catch (err) {
    throw mapCoreError(err);
  }
}
```

- [ ] **Step 4: Build core + run test to verify it passes**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/mcp-bridge test route-tools-for-task`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add packages/mcp-bridge/src/tools/route-tools-for-task.ts packages/mcp-bridge/test/tools/route-tools-for-task.test.ts
git commit -m "feat(mcp-bridge): route_tools_for_task handler"
```

---

## Task 9: Wire the tool into the enum + server (22 → 23)

**Files:**
- Modify: `packages/mcp-bridge/src/tool-name.ts`
- Modify: `packages/mcp-bridge/test/tool-name.test-d.ts`
- Modify: `packages/mcp-bridge/src/server.ts`

- [ ] **Step 1: Update the type regression test** (`test/tool-name.test-d.ts`)

Insert `"route_tools_for_task",` between `"retry_failed_step",` and `"save_memory",` in **all three** lists: the `members` array, the `_t` tuple, and update the tuple-test `it(...)` title from `22-member` to `23-member` (append `+ Phase 7 Tool Router`). Add `"route_tools_for_task",` to the `members` array and the `readonly [...]` tuple at the same alphabetic position.

- [ ] **Step 2: Run the type test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name`
Expected: FAIL (the schema still has 22 members; the 23-tuple won't assign).

- [ ] **Step 3a: Add the enum member** in `packages/mcp-bridge/src/tool-name.ts` — insert `"route_tools_for_task",` between `"retry_failed_step",` and `"save_memory",`, and extend the leading comment with `, and the Phase 7 Tool Router tool (route_tools_for_task)`.

- [ ] **Step 3b: Add the TOOL_DEFS entry** in `server.ts` — insert between the `retry_failed_step` entry and the `save_memory` entry:

```ts
  {
    name: "route_tools_for_task",
    description: "Recommend task-relevant tools; block dangerous/deploy/database.",
  },
```

- [ ] **Step 3c: Add the import** in `server.ts` (with the other tool imports):

```ts
import { handleRouteToolsForTask } from "./tools/route-tools-for-task.js";
```

- [ ] **Step 3d: Add the dispatch case** in `server.ts` — insert in the `switch (toolName)` between the `retry_failed_step` case and the `save_project_rule`/`save_memory` cases (anywhere in the switch is functionally fine; keep it near its alphabetic neighbours):

```ts
      case "route_tools_for_task":
        return handleRouteToolsForTask({ registry: deps.registry }, args);
```

- [ ] **Step 4: Run the type test + build to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name`
Expected: PASS. (The `switch` is exhaustive over the enum; if typecheck complains about a missing case, you missed Step 3d.)

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/test/tool-name.test-d.ts packages/mcp-bridge/src/server.ts
git commit -m "feat(mcp-bridge): register route_tools_for_task (22 -> 23 tools)"
```

---

## Task 10: Server e2e — 23 tools + route round-trip

**Files:**
- Modify: `packages/mcp-bridge/test/server.e2e.test.ts`

- [ ] **Step 1a: Update the tool-count assertion**

Find the existing `it("lists 23 tools", ...)` test — note it currently reads `lists 22 tools` / `toHaveLength(22)`. Change the title to `lists 23 tools` and the assertion to `toHaveLength(23)`.

- [ ] **Step 1b: Add a Phase 7 e2e describe block**

This file does NOT keep a mutable `registry` handle in the test body — it builds the registry via `seededRegistry(projectRoot)` inside a `connect`/`connectP4`-style helper and passes it into `buildServer`, then drives tools through the MCP `client.callTool({ name, arguments })`. There is no `save_tool_definition` MCP tool, so tools must be pre-seeded into the registry *before* `buildServer`. Add a self-contained block at the end of the file that mirrors the existing `connect` helper but pre-seeds two tools:

```ts
import { createInMemoryCoreRegistry } from "@megasaver/core";
// (already imported at the top of the file — do not duplicate)

describe("phase 7 tool router over the bridge", () => {
  const TS7 = "2026-06-12T00:00:00.000Z";

  async function connectWithTools() {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS7,
      updatedAt: TS7,
    });
    const clock = (id: string) => ({ now: () => TS7, newId: () => id });
    registry.createToolDefinition(
      PROJECT_ID,
      { name: "grep", description: "search files", category: "search", risk: "safe", keywords: ["search"] } as never,
      clock("e0000000-0000-4000-8000-000000000001"),
    );
    registry.createToolDefinition(
      PROJECT_ID,
      { name: "ship", description: "deploy to production", category: "deploy", risk: "dangerous", keywords: ["deploy"] } as never,
      clock("e0000000-0000-4000-8000-000000000002"),
    );
    const { server } = buildServer({ registry, storeRoot: "/tmp", now: () => TS7, newId: () => "x" });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { client, server };
  }

  it("route_tools_for_task blocks a dangerous deploy tool", async () => {
    const { client, server } = await connectWithTools();
    const res = (await client.callTool({
      name: "route_tools_for_task",
      arguments: { projectId: PROJECT_ID, task: "search files" },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
      allowedTools: { name: string }[];
      blockedTools: { name: string }[];
    };
    expect(payload.allowedTools.map((t) => t.name)).toEqual(["grep"]);
    expect(payload.blockedTools.map((t) => t.name)).toEqual(["ship"]);
    await server.close();
  });
});
```

(`PROJECT_ID`, `buildServer`, `Client`, and `InMemoryTransport` are already in scope at the top of the file. `createInMemoryCoreRegistry` is already imported — do not re-import. The cast `as never` sidesteps importing `ToolDefinitionInput` here.)

- [ ] **Step 2: Build core + run e2e to verify**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: PASS — 23 tools + the route round-trip green.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-bridge/test/server.e2e.test.ts
git commit -m "test(mcp-bridge): e2e 23 tools + route_tools_for_task round-trip"
```

---

## Task 11: CLI — `mega tools` shared + add

**Files:**
- Create: `apps/cli/src/commands/tools/shared.ts`
- Create: `apps/cli/src/commands/tools/add.ts`
- Test: `apps/cli/test/tools.test.ts`

- [ ] **Step 1: Write the failing test** (the harness pattern from `apps/cli/test/rules.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runToolsAdd } from "../src/commands/tools/add.js";

const PROJECT = "demo";
const TOOL_ID = "e0000000-0000-4000-8000-000000000001";

let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-cli-tools-"));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.MEGA_TEST_TOOL_DEFINITION_ID;
});

function baseEnv() {
  return {
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
  };
}

async function seedProject(): Promise<void> {
  const { createJsonDirectoryCoreRegistry } = await import("@megasaver/core");
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: "11111111-1111-4111-8111-111111111111",
    name: PROJECT,
    rootPath: root,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as never);
}

describe("mega tools add", () => {
  it("registers a tool and prints its id", async () => {
    await seedProject();
    process.env.MEGA_TEST_TOOL_DEFINITION_ID = TOOL_ID;
    const code = await runToolsAdd({
      ...baseEnv(),
      projectName: PROJECT,
      nameFlag: "grep",
      descriptionFlag: "search files",
      categoryFlag: "search",
      riskFlag: "safe",
      keywordFlags: ["search"],
    });
    expect(code).toBe(0);
    expect(out).toEqual([TOOL_ID]);
  });

  it("rejects an invalid category with a clean message", async () => {
    await seedProject();
    const code = await runToolsAdd({
      ...baseEnv(),
      projectName: PROJECT,
      nameFlag: "x",
      descriptionFlag: "x",
      categoryFlag: "network",
      riskFlag: "safe",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain('invalid category "network"');
  });

  it("rejects an invalid risk with a clean message", async () => {
    await seedProject();
    const code = await runToolsAdd({
      ...baseEnv(),
      projectName: PROJECT,
      nameFlag: "x",
      descriptionFlag: "x",
      categoryFlag: "search",
      riskFlag: "high",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain('invalid risk "high"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test tools`
Expected: FAIL — `tools/add.js` not found.

- [ ] **Step 3a: Create `apps/cli/src/commands/tools/shared.ts`**

```ts
import type { ToolDefinition } from "@megasaver/core";
import { toolDefinitionIdSchema } from "@megasaver/shared";

export { toolDefinitionIdSchema };

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatToolLine(
  t: Pick<ToolDefinition, "id" | "risk" | "category" | "name">,
): string {
  return `${t.id}  ${t.risk.padEnd(9, " ")}  ${t.category.padEnd(10, " ")}  ${t.name}`;
}
```

- [ ] **Step 3b: Create `apps/cli/src/commands/tools/add.ts`**

```ts
import {
  type ToolDefinitionInput,
  toolCategorySchema,
  toolDefinitionInputSchema,
  toolRiskSchema,
} from "@megasaver/core";
import { titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { toStringArray } from "./shared.js";

export type RunToolsAddInput = {
  projectName: string;
  nameFlag: string;
  descriptionFlag: string;
  categoryFlag: string;
  riskFlag: string;
  keywordFlags?: unknown;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

const CATEGORY_HINT = toolCategorySchema.options.join(" | ");
const RISK_HINT = toolRiskSchema.options.join(" | ");

export async function runToolsAdd(input: RunToolsAddInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  // Closed-enum validation at the boundary (Phase 5/6 lesson): a clean message,
  // never a raw zod dump, for a bad --category / --risk.
  const category = toolCategorySchema.safeParse(input.categoryFlag);
  if (!category.success) {
    input.stderr(`error: invalid category "${input.categoryFlag}" (${CATEGORY_HINT})`);
    return 1;
  }
  const risk = toolRiskSchema.safeParse(input.riskFlag);
  if (!risk.success) {
    input.stderr(`error: invalid risk "${input.riskFlag}" (${RISK_HINT})`);
    return 1;
  }
  let name: string;
  try {
    name = titleSchema.parse(input.nameFlag);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const toolInput = toolDefinitionInputSchema.safeParse({
    name,
    description: input.descriptionFlag,
    category: category.data,
    risk: risk.data,
    keywords: toStringArray(input.keywordFlags),
  } satisfies Partial<ToolDefinitionInput>);
  if (!toolInput.success) {
    input.stderr(`error: invalid tool definition: ${toolInput.error.message}`);
    return 1;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const fixed = readTestEnv("MEGA_TEST_TOOL_DEFINITION_ID");
    const created = registry.createToolDefinition(project.id, toolInput.data, {
      now: () => readTestEnv("MEGA_TEST_NOW") ?? now(),
      newId: () => fixed ?? newId(),
    });
    input.stdout(input.json ? JSON.stringify(created) : created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const toolsAddCommand = defineCommand({
  meta: { name: "add", description: "Register a tool definition." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name (must exist)." },
    name: { type: "string", required: true, description: "Tool name." },
    description: { type: "string", required: true, description: "What the tool does." },
    category: {
      type: "string",
      required: true,
      description: "filesystem | search | git | test | package | database | deploy | browser | dangerous.",
    },
    risk: { type: "string", required: true, description: "safe | medium | dangerous." },
    keyword: { type: "string", description: "Retrieval keyword (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runToolsAdd({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      nameFlag: typeof args.name === "string" ? args.name : "",
      descriptionFlag: typeof args.description === "string" ? args.description : "",
      categoryFlag: typeof args.category === "string" ? args.category : "",
      riskFlag: typeof args.risk === "string" ? args.risk : "",
      keywordFlags: args.keyword,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> **Note:** `toolDefinitionInputSchema` has required `inputSchema`/`outputSchema` keys typed `z.unknown()`; an *absent* key satisfies `z.unknown()` (value `undefined`), so omitting them in the `safeParse` object is valid — the registry builder defaults them to `null`. The `satisfies Partial<ToolDefinitionInput>` keeps the object shape honest without forcing the opaque keys.

- [ ] **Step 4: Build core + run test to verify it passes**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/cli test tools`
Expected: PASS (the `add` tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add apps/cli/src/commands/tools/shared.ts apps/cli/src/commands/tools/add.ts apps/cli/test/tools.test.ts
git commit -m "feat(cli): mega tools add — register a tool definition"
```

---

## Task 12: CLI — list + route + explain + group + main.ts

**Files:**
- Create: `apps/cli/src/commands/tools/list.ts`
- Create: `apps/cli/src/commands/tools/route.ts`
- Create: `apps/cli/src/commands/tools/explain.ts`
- Create: `apps/cli/src/commands/tools/index.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/tools.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
import { runToolsExplain } from "../src/commands/tools/explain.js";
import { runToolsList } from "../src/commands/tools/list.js";
import { runToolsRoute } from "../src/commands/tools/route.js";

async function seedTwoTools(): Promise<void> {
  const { createJsonDirectoryCoreRegistry } = await import("@megasaver/core");
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  const clock = (id: string) => ({ now: () => "2026-06-12T00:00:00.000Z", newId: () => id });
  const project = registry.listProjects().find((p) => p.name === PROJECT);
  if (!project) throw new Error("seed project first");
  registry.createToolDefinition(
    project.id,
    { name: "grep", description: "search files", category: "search", risk: "safe", keywords: ["search"] } as never,
    clock("e0000000-0000-4000-8000-000000000001"),
  );
  registry.createToolDefinition(
    project.id,
    { name: "ship", description: "deploy to production", category: "deploy", risk: "dangerous", keywords: ["deploy"] } as never,
    clock("e0000000-0000-4000-8000-000000000002"),
  );
}

describe("mega tools list", () => {
  it("lists registered tools", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsList({ ...baseEnv(), projectName: PROJECT });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("grep");
    expect(out.join("\n")).toContain("ship");
  });
});

describe("mega tools route", () => {
  it("allows the safe match and blocks the dangerous deploy tool", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsRoute({ ...baseEnv(), projectName: PROJECT, taskFlag: "search files" });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("allowed");
    expect(text).toContain("grep");
    expect(text).toContain("blocked");
    expect(text).toContain("ship");
    expect(text).toContain("blocked as dangerous/deploy/database");
  });

  it("with no task, allows all safe tools", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsRoute({ ...baseEnv(), projectName: PROJECT });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("grep");
  });
});

describe("mega tools explain", () => {
  it("renders per-tool block reasons", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsExplain({ ...baseEnv(), projectName: PROJECT });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("routable");
    expect(text).toContain("blocked: category deploy");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli test tools`
Expected: FAIL — `list.js`/`route.js`/`explain.js` not found.

- [ ] **Step 3a: Create `apps/cli/src/commands/tools/list.ts`**

```ts
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatToolLine } from "./shared.js";

export type RunToolsListInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runToolsList(input: RunToolsListInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const tools = registry.listToolDefinitions(project.id);
    if (input.json) {
      input.stdout(JSON.stringify(tools));
    } else {
      for (const t of tools) input.stdout(formatToolLine(t));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const toolsListCommand = defineCommand({
  meta: { name: "list", description: "List registered tool definitions." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runToolsList({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3b: Create `apps/cli/src/commands/tools/route.ts`**

```ts
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatToolLine } from "./shared.js";

export type RunToolsRouteInput = {
  projectName: string;
  taskFlag?: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runToolsRoute(input: RunToolsRouteInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const result = registry.routeToolsForTask(project.id, input.taskFlag);
    if (input.json) {
      input.stdout(JSON.stringify(result));
    } else {
      input.stdout("allowed:");
      for (const t of result.allowedTools) input.stdout(`  ${formatToolLine(t)}`);
      input.stdout("blocked:");
      for (const t of result.blockedTools) input.stdout(`  ${formatToolLine(t)}`);
      input.stdout(`reason: ${result.reason}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const toolsRouteCommand = defineCommand({
  meta: { name: "route", description: "Recommend task-relevant tools; block dangerous ones." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    task: { type: "string", description: "Task text to route for (omit to allow all safe tools)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runToolsRoute({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3c: Create `apps/cli/src/commands/tools/explain.ts`**

```ts
import { isBlockedTool } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

export type RunToolsExplainInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

const BLOCKED_CATEGORIES = new Set(["dangerous", "deploy", "database"]);

export async function runToolsExplain(input: RunToolsExplainInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const tools = registry.listToolDefinitions(project.id);
    if (input.json) {
      input.stdout(
        JSON.stringify(tools.map((t) => ({ ...t, blocked: isBlockedTool(t) }))),
      );
      return 0;
    }
    for (const t of tools) {
      let note: string;
      if (t.risk === "dangerous") note = "blocked: risk dangerous";
      else if (BLOCKED_CATEGORIES.has(t.category)) note = `blocked: category ${t.category}`;
      else note = "routable";
      input.stdout(`${t.name}  category=${t.category}  risk=${t.risk}  -> ${note}`);
    }
    input.stdout(
      "policy: dangerous/deploy/database tools are never routed to a plain task.",
    );
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const toolsExplainCommand = defineCommand({
  meta: { name: "explain", description: "Explain each tool's category/risk and why it is blocked." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runToolsExplain({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3d: Create `apps/cli/src/commands/tools/index.ts`**

```ts
import { defineCommand } from "citty";
import { toolsAddCommand } from "./add.js";
import { toolsExplainCommand } from "./explain.js";
import { toolsListCommand } from "./list.js";
import { toolsRouteCommand } from "./route.js";

export { type RunToolsAddInput, runToolsAdd, toolsAddCommand } from "./add.js";
export { type RunToolsListInput, runToolsList, toolsListCommand } from "./list.js";
export { type RunToolsRouteInput, runToolsRoute, toolsRouteCommand } from "./route.js";
export { type RunToolsExplainInput, runToolsExplain, toolsExplainCommand } from "./explain.js";

export const toolsCommand = defineCommand({
  meta: { name: "tools", description: "Register tools and route a task-relevant, danger-gated subset." },
  subCommands: {
    add: toolsAddCommand,
    list: toolsListCommand,
    route: toolsRouteCommand,
    explain: toolsExplainCommand,
  },
});
```

- [ ] **Step 3e: Wire into `apps/cli/src/main.ts`** — add the import (with the other command imports):

```ts
import { toolsCommand } from "./commands/tools/index.js";
```

and add to `subCommands` (after `task: taskCommand,`):

```ts
    tools: toolsCommand,
```

- [ ] **Step 4: Build core + run tests to verify they pass**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/cli test tools`
Expected: PASS (all `tools` CLI tests).

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add apps/cli/src/commands/tools/ apps/cli/src/main.ts apps/cli/test/tools.test.ts
git commit -m "feat(cli): mega tools list/route/explain + group wiring"
```

---

## Task 13: Full gate + changeset

**Files:**
- Create: `.changeset/phase7-tool-router.md`

- [ ] **Step 1: Lint the new files**

Run: `pnpm lint:fix` (= `biome check --write`), then inspect `git diff --stat` to confirm only Phase 7 files were reformatted.

- [ ] **Step 2: Run the CI-equivalent gate**

Run: `pnpm verify`
Expected: lint (`biome check .`) clean, typecheck clean, all tests pass, conventions ok. If a per-package step fails only on an unresolved `@megasaver/*` import, build that dep (`pnpm --filter @megasaver/shared build`, `pnpm --filter @megasaver/core build`) and re-run.

- [ ] **Step 3: Confirm the 23-tool surface end-to-end**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e -t "lists 23 tools"`
Expected: PASS.

- [ ] **Step 4: Confirm the danger-gating headline behaviour**

Run: `pnpm --filter @megasaver/core test tool-router -t "NEVER promotes a dangerous tool"`
Expected: PASS.

- [ ] **Step 5: Write the changeset** (`.changeset/phase7-tool-router.md`)

```md
---
"@megasaver/shared": minor
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 7 — Tool Router. Adds a deterministic, per-project tool router. New
first-class ToolDefinition entity (name/description, category enum
[filesystem/search/git/test/package/database/deploy/browser/dangerous],
risk enum [safe/medium/dangerous], normalized keywords, opaque
z.unknown() inputSchema/outputSchema — descriptive only, never executed),
stored as per-project JSONL. New pure routeToolsForTask(tools, query)
reusing rankBm25: a security gate runs BEFORE relevance — a tool is
blocked (never routed to a plain task) when risk=dangerous OR category in
{dangerous, deploy, database}; among the rest, score>0 tools are allowed
(descending score, id tiebreak), irrelevant tools are omitted. Returns
{ allowedTools, blockedTools, reason }. New branded ToolDefinitionId,
4 CoreRegistry methods (createToolDefinition, getToolDefinition,
listToolDefinitions, routeToolsForTask), 2 error codes
(tool_definition_already_exists, tool_definition_not_found), 1 MCP tool
route_tools_for_task (bridge now 23 tools), and CLI mega tools
add/list/route/explain. Registration is CLI-only; the router only advises
(no execution, no enforcement at a call site). No LLM, no embeddings.
```

(Match the existing `.changeset/` file format if it differs.)

- [ ] **Step 6: Commit**

```bash
git add .changeset/phase7-tool-router.md
git commit -m "chore: changeset for Phase 7 Tool Router"
```

- [ ] **Step 7: Push + PR (when ready)**

```bash
git push -u origin feat/phase7-tool-router
```

Open a PR titled `feat: Phase 7 — Tool Router (22 → 23 tools)` against `main`, linking the spec.

---

## Self-Review Notes

- **Spec coverage:** §3b id→T1, §6 error codes→T2, §3 entity/enums/input→T3, §4 pure router→T4, §5 store→T5, §5 registry→T6, barrel→T7, §7 MCP tool→T8 + enum/server wiring T9 + e2e T10, §8 CLI→T11 (shared+add) / T12 (list/route/explain/group/main), §11 testing→tests in every task, §9/§10 reconciliation+risk→covered by the gate test selectors in T13, changeset/gate→T13. Every spec section maps to a task.
- **Type/name consistency:** registry methods (`createToolDefinition`/`getToolDefinition`/`listToolDefinitions`/`routeToolsForTask`) identical across interface, both impls, MCP, CLI. Pure fns (`isBlockedTool`/`routeToolsForTask`) and types (`ToolDefinition`/`ToolDefinitionInput`/`ToolRouteResult`/`ToolCategory`/`ToolRisk`) consistent between definition and consumers. The pure `routeToolsForTask` is imported as `routeTools` in `registry.ts`/`json-directory-registry.ts` to avoid clashing with the same-named registry method (mirrors `searchFailedAttempts as searchFailures`) — flagged in T6. Handler `handleRouteToolsForTask` matches tool file, server import, dispatch, tests. Fixture ids (`TOOL_ID`/`SHIP_ID`, `e0…01`/`e0…02`) consistent across core, mcp, cli tests.
- **Advisor not enforcer:** the router never executes a tool and is never wired into `@megasaver/policy` / `mega_run_command`; `tool-router.ts` imports only `rankBm25` and the entity type. Flagged in spec §1/§13; no plan task touches an execution path.
- **Risk gate before relevance:** `routeToolsForTask` splits blocked vs candidates by `isBlockedTool` FIRST; only candidates are BM25-ranked, so no text match can promote a blocked tool. The "NEVER promotes a dangerous tool" test (T4) and the T13 Step 4 selector lock this exit criterion. deploy/database blocked-by-category justified in spec §4b.
- **Irrelevant ≠ forbidden:** a non-blocked tool with score ≤ 0 is omitted from BOTH lists; only dangerous/deploy/database tools populate `blockedTools`. Tested in T4 ("allows only score>0 … omitted from both lists").
- **Atomicity (json impl):** `createToolDefinition` does read-dup-check-write inline under one `withDirLock`; `get`/`list`/`route` are pure reads with no lock. The shared `buildToolDefinitionFromInput` is store-agnostic and never locks — flagged in T6.
- **Opaque schemas:** `inputSchema`/`outputSchema` are `z.unknown()`, defaulted to `null` by the builder, round-tripped through JSONL unchanged (store test T5), never read by the router. The `.strict()`-vs-`z.unknown()` orthogonality is noted in spec §3d and the T11 note.
- **Closed-enum-at-boundary (Phase 5/6 lesson):** `mega tools add` validates `--category`/`--risk` via `safeParse` with a clean `(a | b | c)` hint and exit 1 — never a raw zod dump. Tested in T11.
- **index → add mapping:** justified in spec §8a (avoids colliding with the existing top-level `mega index` repo-index command); the CLI surface is `add | list | route | explain`, with `list` covering the "show what's indexed" half. No literal `mega tools index`.
- **MCP count:** exactly +1 (`route_tools_for_task`), 22 → 23; registration is CLI-only (spec §7a). Enum stays closed + alphabetic; `route_tools_for_task` sorts between `retry_failed_step` and `save_memory` in `tool-name.ts`, `TOOL_DEFS`, the `test-d` tuple (T9), and the e2e count (T10).
- **No placeholders:** every code step is complete and runnable. The two test-only edits described in prose (T9 test-d insertion, T10 e2e seeding) reference the existing file's own helpers because their exact local names live in those files; both give the full snippet to add.
- **Task count:** 13 tasks, each one TDD cycle with a commit. Suggested batching for subagent-driven execution: **Batch A (core) T1–T7**, **Batch B (MCP) T8–T10**, **Batch C (CLI) T11–T12**, **Batch D (gate) T13**. T1–T7 are sequential (each builds on the prior core module); T8–T10 depend on T7's built core; T11–T12 depend on T7's built core but are independent of the MCP batch (could run in parallel with B); T13 depends on all.
