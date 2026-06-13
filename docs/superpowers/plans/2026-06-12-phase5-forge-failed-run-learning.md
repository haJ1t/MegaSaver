# Phase 5 — FORGE Failed-Run Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the failed-run learning loop on the Phase 4 substrate — find similar past failures, convert a failure into a reusable rule, and rank rules that apply to a task — via 2 pure ranking modules, 3 registry methods, 3 MCP tools (15→18), and a CLI surface.

**Architecture:** Two pure functions (`searchFailedAttempts`, `rankApplicableRules`) reuse the existing `rankBm25` primitive — no embeddings, no LLM. Three `CoreRegistry` methods (`updateFailedAttempt`, `searchFailedAttempts`, `convertFailureToRule`) are implemented identically on the in-memory and json-directory backends; `convertFailureToRule` is atomic (rule create + failure flip under one lock). MCP tools and CLI commands are thin handlers over these, mirroring Phase 4.

**Tech Stack:** TypeScript (strict ESM, `exactOptionalPropertyTypes`), zod, vitest, citty (CLI), `@modelcontextprotocol/sdk`, pnpm + turbo, biome.

**Spec:** `docs/superpowers/specs/2026-06-12-phase5-forge-failed-run-learning-design.md`
**Working dir:** `.worktrees/phase5-forge` (branch `feat/phase5-forge-learning`, off `main` @ Phase 4).

**Test commands:** per-package `pnpm --filter @megasaver/<pkg> test <pattern>`; type `pnpm --filter @megasaver/<pkg> typecheck`. Final gate: `pnpm verify` (= `pnpm lint && pnpm typecheck && pnpm test && pnpm conventions:check`; lint is `biome check .` over the whole repo — run it, the per-package turbo lint misses repo-wide format/import-sort). Workspace packages resolve to built `dist/`; if a dependent test fails on an unresolved `@megasaver/*` import, build that dep first (`pnpm --filter @megasaver/<dep> build`).

---

## File Structure

**Create (core):**
- `packages/core/src/failed-attempt-search.ts` — pure `searchFailedAttempts`
- `packages/core/src/project-rule-ranking.ts` — pure `rankApplicableRules`
- `packages/core/test/failed-attempt-search.test.ts`
- `packages/core/test/project-rule-ranking.test.ts`
- `packages/core/test/registry-forge.test.ts` — registry methods (both impls)

**Modify (core):**
- `packages/core/src/failed-attempt.ts` — `failedAttemptPatchSchema`, `seedFailureEvidence`
- `packages/core/src/project-rule.ts` — `failureToRuleInputSchema`
- `packages/core/src/errors.ts` — `failed_attempt_already_converted`
- `packages/core/src/registry.ts` — interface + in-memory impl
- `packages/core/src/json-directory-registry.ts` — json impl
- `packages/core/src/index.ts` — barrel exports

**Create (mcp-bridge):**
- `packages/mcp-bridge/src/tools/find-similar-failures.ts`
- `packages/mcp-bridge/src/tools/get-applicable-rules.ts`
- `packages/mcp-bridge/src/tools/convert-failure-to-rule.ts`
- `packages/mcp-bridge/test/tools/forge-tools.test.ts`

**Modify (mcp-bridge):**
- `packages/mcp-bridge/src/tool-name.ts` (15→18) + `test/tool-name.test-d.ts`
- `packages/mcp-bridge/src/server.ts`
- `packages/mcp-bridge/test/server.e2e.test.ts`

**Create (cli):** `apps/cli/src/commands/fail/{index,record,list,show,shared}.ts`, `apps/cli/src/commands/rules/{index,list,add,apply,shared}.ts`, `apps/cli/src/commands/learn.ts` + matching tests under `apps/cli/test/`.
**Modify (cli):** `apps/cli/src/main.ts`.

**Create (release):** `.changeset/phase5-forge.md`.

---

## Task 1: Pure module — searchFailedAttempts

**Files:**
- Create: `packages/core/src/failed-attempt-search.ts`
- Test: `packages/core/test/failed-attempt-search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { FailedAttempt } from "../src/failed-attempt.js";
import { searchFailedAttempts } from "../src/failed-attempt-search.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
function fa(over: Partial<FailedAttempt> & { id: string }): FailedAttempt {
  return {
    id: over.id,
    projectId: PROJECT_ID as FailedAttempt["projectId"],
    sessionId: null,
    task: over.task ?? "task",
    failedStep: over.failedStep ?? "step",
    relatedFiles: [],
    convertedToRule: over.convertedToRule ?? false,
    createdAt: over.createdAt ?? "2026-06-12T00:00:00.000Z",
    ...(over.errorOutput !== undefined ? { errorOutput: over.errorOutput } : {}),
    ...(over.suspectedCause !== undefined ? { suspectedCause: over.suspectedCause } : {}),
  } as FailedAttempt;
}

describe("searchFailedAttempts", () => {
  it("ranks by BM25 over task+failedStep+errorOutput+suspectedCause", () => {
    const a = fa({ id: "a0000000-0000-4000-8000-000000000001", task: "fix login auth bug" });
    const b = fa({ id: "a0000000-0000-4000-8000-000000000002", task: "update navbar styling" });
    const out = searchFailedAttempts([a, b], { text: "login auth" });
    expect(out.map((x) => x.id)).toEqual([a.id]);
  });

  it("drops zero-overlap matches", () => {
    const a = fa({ id: "a0000000-0000-4000-8000-000000000001", task: "login" });
    expect(searchFailedAttempts([a], { text: "completely unrelated terms" })).toEqual([]);
  });

  it("excludes converted failures unless includeConverted", () => {
    const a = fa({ id: "a0000000-0000-4000-8000-000000000001", task: "login", convertedToRule: true });
    expect(searchFailedAttempts([a], { text: "login" })).toEqual([]);
    expect(searchFailedAttempts([a], { text: "login", includeConverted: true })).toHaveLength(1);
  });

  it("with no text returns newest-first, stable by id", () => {
    const a = fa({ id: "a0000000-0000-4000-8000-000000000001", createdAt: "2026-06-12T01:00:00.000Z" });
    const b = fa({ id: "a0000000-0000-4000-8000-000000000002", createdAt: "2026-06-12T02:00:00.000Z" });
    expect(searchFailedAttempts([a, b], {}).map((x) => x.id)).toEqual([b.id, a.id]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test failed-attempt-search`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the module**

```ts
import { rankBm25 } from "@megasaver/retrieval";
import type { FailedAttemptId } from "@megasaver/shared";
import { z } from "zod";
import type { FailedAttempt } from "./failed-attempt.js";

const DEFAULT_LIMIT = 20;

export const failedAttemptSearchQuerySchema = z
  .object({
    text: z.string().optional(),
    includeConverted: z.boolean().default(false),
    limit: z.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();

export type FailedAttemptSearchQuery = {
  text?: string;
  includeConverted?: boolean;
  limit?: number;
};

// Local, deterministic, offline failure retrieval (Phase 5 / FORGE): drop
// already-converted failures (they became rules) unless includeConverted, then
// BM25 over task+failedStep+errorOutput+suspectedCause. No text → newest-first,
// stable by id. Mirrors searchMemoryEntries (memory-search.ts).
export function searchFailedAttempts(
  attempts: readonly FailedAttempt[],
  query: FailedAttemptSearchQuery,
): FailedAttempt[] {
  const q = failedAttemptSearchQuerySchema.parse(query);
  const filtered = attempts.filter((a) => q.includeConverted || !a.convertedToRule);

  const text = q.text?.trim();
  if (text === undefined || text.length === 0) {
    return [...filtered]
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, q.limit);
  }

  const documents = filtered.map((a) => ({
    id: a.id,
    text: `${a.task} ${a.failedStep} ${a.errorOutput ?? ""} ${a.suspectedCause ?? ""}`,
  }));
  const ranked = rankBm25({ query: text, documents, topN: q.limit });
  const byId = new Map(filtered.map((a) => [a.id, a]));
  return ranked
    .filter((hit) => hit.score > 0)
    .map((hit) => byId.get(hit.id as FailedAttemptId))
    .filter((a): a is FailedAttempt => a !== undefined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test failed-attempt-search`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/failed-attempt-search.ts packages/core/test/failed-attempt-search.test.ts
git commit -m "feat(core): searchFailedAttempts BM25 similarity (pure)"
```

---

## Task 2: Pure module — rankApplicableRules

**Files:**
- Create: `packages/core/src/project-rule-ranking.ts`
- Test: `packages/core/test/project-rule-ranking.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ProjectRule } from "../src/project-rule.js";
import { rankApplicableRules } from "../src/project-rule-ranking.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
function rule(over: Partial<ProjectRule> & { id: string }): ProjectRule {
  return {
    id: over.id,
    projectId: PROJECT_ID as ProjectRule["projectId"],
    title: over.title ?? "title",
    rule: over.rule ?? "do the thing",
    appliesTo: over.appliesTo ?? [],
    evidence: over.evidence ?? [],
    severity: over.severity ?? "info",
    confidence: over.confidence ?? "medium",
    createdFrom: over.createdFrom ?? "manual",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as ProjectRule;
}

describe("rankApplicableRules", () => {
  it("ranks a path-matching rule above a pure text match", () => {
    const db = rule({ id: "b0000000-0000-4000-8000-000000000001", title: "migrate", appliesTo: ["src/db/"] });
    const txt = rule({ id: "b0000000-0000-4000-8000-000000000002", title: "migrate prisma schema", rule: "regenerate client" });
    const out = rankApplicableRules([db, txt], { task: "migrate prisma", files: ["src/db/schema.ts"] });
    expect(out[0]?.rule.id).toBe(db.id);
    expect(out[0]?.reason).toContain("applies to src/db/schema.ts");
  });

  it("drops zero-score rules when a filter is present", () => {
    const r = rule({ id: "b0000000-0000-4000-8000-000000000001", title: "navbar", rule: "ui only", appliesTo: ["src/ui/"] });
    expect(rankApplicableRules([r], { task: "database migration", files: ["src/db/x.ts"] })).toEqual([]);
  });

  it("with no filter returns all sorted by severity then id", () => {
    const info = rule({ id: "b0000000-0000-4000-8000-000000000001", severity: "info" });
    const crit = rule({ id: "b0000000-0000-4000-8000-000000000002", severity: "critical" });
    const out = rankApplicableRules([info, crit], {});
    expect(out.map((x) => x.rule.id)).toEqual([crit.id, info.id]);
    expect(out[0]?.reason).toBe("no task filter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test project-rule-ranking`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the module**

```ts
import { rankBm25 } from "@megasaver/retrieval";
import { z } from "zod";
import type { ProjectRule, RuleSeverity } from "./project-rule.js";

const DEFAULT_LIMIT = 20;
// A file/appliesTo overlap is stronger evidence than a pure text hit, so weight
// each matched path above a typical single-term BM25 score.
const PATH_MATCH_WEIGHT = 2;

export const applicableRuleQuerySchema = z
  .object({
    task: z.string().optional(),
    files: z.array(z.string()).default([]),
    limit: z.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();

export type ApplicableRuleQuery = { task?: string; files?: readonly string[]; limit?: number };
export type RankedRule = { rule: ProjectRule; score: number; reason: string };

const SEVERITY_RANK: Record<RuleSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function rankApplicableRules(
  rules: readonly ProjectRule[],
  query: ApplicableRuleQuery,
): RankedRule[] {
  const q = applicableRuleQuerySchema.parse(query);
  const text = q.task?.trim();
  const hasText = text !== undefined && text.length > 0;
  const hasFilter = hasText || q.files.length > 0;

  if (!hasFilter) {
    return [...rules]
      .sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id),
      )
      .slice(0, q.limit)
      .map((rule) => ({ rule, score: 0, reason: "no task filter" }));
  }

  const textScore = new Map<string, number>();
  if (hasText) {
    const documents = rules.map((r) => ({
      id: r.id,
      text: `${r.title} ${r.rule} ${r.evidence.join(" ")}`,
    }));
    for (const hit of rankBm25({ query: text as string, documents, topN: rules.length })) {
      if (hit.score > 0) textScore.set(hit.id, hit.score);
    }
  }

  const scored: RankedRule[] = [];
  for (const rule of rules) {
    const matchedPaths: string[] = [];
    for (const file of q.files) {
      for (const glob of rule.appliesTo) {
        if (glob.length > 0 && (file.startsWith(glob) || glob.startsWith(file))) {
          matchedPaths.push(file);
          break;
        }
      }
    }
    const score = matchedPaths.length * PATH_MATCH_WEIGHT + (textScore.get(rule.id) ?? 0);
    if (score <= 0) continue;
    const reasons: string[] = [];
    if (matchedPaths.length > 0) reasons.push(`applies to ${matchedPaths.join(", ")}`);
    if ((textScore.get(rule.id) ?? 0) > 0) reasons.push("matches task text");
    scored.push({ rule, score, reason: reasons.join("; ") });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        SEVERITY_RANK[a.rule.severity] - SEVERITY_RANK[b.rule.severity] ||
        a.rule.id.localeCompare(b.rule.id),
    )
    .slice(0, q.limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test project-rule-ranking`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/project-rule-ranking.ts packages/core/test/project-rule-ranking.test.ts
git commit -m "feat(core): rankApplicableRules scored rule retrieval (pure)"
```

---

## Task 3: Convert schemas + evidence seed

**Files:**
- Modify: `packages/core/src/failed-attempt.ts` (append)
- Modify: `packages/core/src/project-rule.ts` (append)
- Test: `packages/core/test/forge-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { type FailedAttempt, failedAttemptPatchSchema, seedFailureEvidence } from "../src/failed-attempt.js";
import { failureToRuleInputSchema } from "../src/project-rule.js";

describe("failedAttemptPatchSchema", () => {
  it("accepts the closed mutable set", () => {
    expect(failedAttemptPatchSchema.parse({ convertedToRule: true }).convertedToRule).toBe(true);
    expect(failedAttemptPatchSchema.parse({ resolution: "use <=" }).resolution).toBe("use <=");
  });
  it("rejects unknown keys (strict)", () => {
    expect(() => failedAttemptPatchSchema.parse({ task: "x" })).toThrow();
  });
});

describe("failureToRuleInputSchema", () => {
  it("requires title/rule/severity, allows optional confidence/appliesTo/evidence", () => {
    const parsed = failureToRuleInputSchema.parse({ title: "t", rule: "r", severity: "warning" });
    expect(parsed.severity).toBe("warning");
  });
  it("rejects an unknown key and a missing severity", () => {
    expect(() => failureToRuleInputSchema.parse({ title: "t", rule: "r", severity: "warning", id: "x" })).toThrow();
    expect(() => failureToRuleInputSchema.parse({ title: "t", rule: "r" })).toThrow();
  });
});

describe("seedFailureEvidence", () => {
  it("produces a deterministic evidence line", () => {
    const f = {
      id: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-06-12T00:00:00.000Z",
      failedStep: "run auth tests",
      errorOutput: "401",
    } as FailedAttempt;
    expect(seedFailureEvidence(f)).toBe(
      "Derived from failed attempt a0000000-0000-4000-8000-000000000001 (2026-06-12T00:00:00.000Z): run auth tests — 401",
    );
  });
  it("falls back when errorOutput is absent", () => {
    const f = {
      id: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-06-12T00:00:00.000Z",
      failedStep: "step",
    } as FailedAttempt;
    expect(seedFailureEvidence(f)).toContain("no error output");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test forge-schemas`
Expected: FAIL — exports missing.

- [ ] **Step 3a: Append to `failed-attempt.ts`**

```ts
// Partial update over the MUTABLE fields only (mirrors memoryEntryUpdatePatchSchema).
// id/projectId/sessionId/task/failedStep/relatedFiles/createdAt are immutable
// after create; `.strict()` rejects them.
export const failedAttemptPatchSchema = z
  .object({
    convertedToRule: z.boolean().optional(),
    resolution: z.string().trim().min(1).optional(),
    suspectedCause: z.string().trim().min(1).optional(),
  })
  .strict();

export type FailedAttemptPatch = z.infer<typeof failedAttemptPatchSchema>;

// Deterministic evidence line linking a derived rule back to its source failure.
export function seedFailureEvidence(failure: FailedAttempt): string {
  return `Derived from failed attempt ${failure.id} (${failure.createdAt}): ${failure.failedStep} — ${failure.errorOutput ?? "no error output"}`;
}
```

- [ ] **Step 3b: Append to `project-rule.ts`**

```ts
// Caller-supplied insight for convertFailureToRule: the rule fields the agent
// writes. id/projectId/createdFrom/createdAt/updatedAt are engine-owned.
export const failureToRuleInputSchema = z
  .object({
    title: titleSchema,
    rule: z.string().trim().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
  })
  .strict();

export type FailureToRuleInput = z.infer<typeof failureToRuleInputSchema>;
```

(`titleSchema`, `ruleSeveritySchema`, `ruleConfidenceSchema` are already imported/declared in `project-rule.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test forge-schemas`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/failed-attempt.ts packages/core/src/project-rule.ts packages/core/test/forge-schemas.test.ts
git commit -m "feat(core): convert schemas (failedAttemptPatch, failureToRuleInput) + evidence seed"
```

---

## Task 4: Registry error code

**Files:**
- Modify: `packages/core/src/errors.ts` (the `coreRegistryErrorCodeSchema` enum)
- Test: `packages/core/test/errors-forge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 5 registry error code", () => {
  it("includes failed_attempt_already_converted", () => {
    expect(coreRegistryErrorCodeSchema.parse("failed_attempt_already_converted")).toBe(
      "failed_attempt_already_converted",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test errors-forge`
Expected: FAIL.

- [ ] **Step 3: Append the code**

Add `"failed_attempt_already_converted",` as the last member of the `coreRegistryErrorCodeSchema` enum in `packages/core/src/errors.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test errors-forge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/test/errors-forge.test.ts
git commit -m "feat(core): failed_attempt_already_converted error code"
```

---

## Task 5: Registry methods (interface + both impls)

**Files:**
- Modify: `packages/core/src/registry.ts` (interface + in-memory)
- Modify: `packages/core/src/json-directory-registry.ts` (json)
- Test: `packages/core/test/registry-forge.test.ts`

> One task: the interface change forces both impls to compile together.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedAttemptIdSchema, projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const FA_ID = failedAttemptIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const TS = "2026-06-12T00:00:00.000Z";
const RULE_ID = "c0000000-0000-4000-8000-000000000001";

const project = { id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS } as const;
const failure = {
  id: FA_ID,
  projectId: PROJECT_ID,
  sessionId: null,
  task: "fix login bug",
  failedStep: "run auth tests",
  errorOutput: "401",
  relatedFiles: ["src/middleware/auth.ts"],
  convertedToRule: false,
  createdAt: TS,
} as const;
const clock = { now: () => TS, newId: () => RULE_ID };

function suite(name: string, make: () => CoreRegistry) {
  describe(`${name}: forge registry`, () => {
    it("updateFailedAttempt patches mutable fields", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      const updated = r.updateFailedAttempt(FA_ID, { resolution: "use <=" });
      expect(updated.resolution).toBe("use <=");
    });

    it("updateFailedAttempt throws on missing", () => {
      const r = make();
      expect(() => r.updateFailedAttempt(FA_ID, { resolution: "x" })).toThrowError(/failed_attempt_not_found|does not exist/);
    });

    it("searchFailedAttempts scopes to project and ranks by text", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      expect(r.searchFailedAttempts(PROJECT_ID, { text: "login auth" }).map((f) => f.id)).toEqual([FA_ID]);
    });

    it("convertFailureToRule creates a seeded rule and flips the failure (atomic)", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      const { rule, failure: flipped } = r.convertFailureToRule(
        FA_ID,
        { title: "Migrate first", rule: "create migration", severity: "warning" },
        clock,
      );
      expect(rule.createdFrom).toBe("failed_attempt");
      expect(rule.appliesTo).toEqual(["src/middleware/auth.ts"]); // defaulted from relatedFiles
      expect(rule.evidence.some((e) => e.includes(FA_ID))).toBe(true);
      expect(flipped.convertedToRule).toBe(true);
      expect(r.getProjectRule(rule.id as never)?.id).toBe(RULE_ID);
      expect(r.getFailedAttempt(FA_ID)?.convertedToRule).toBe(true);
    });

    it("convertFailureToRule rejects a double-convert", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      r.convertFailureToRule(FA_ID, { title: "t", rule: "r", severity: "info" }, clock);
      expect(() =>
        r.convertFailureToRule(FA_ID, { title: "t", rule: "r", severity: "info" }, { now: () => TS, newId: () => "c0000000-0000-4000-8000-000000000002" }),
      ).toThrowError(/failed_attempt_already_converted|already converted/);
    });

    it("convertFailureToRule throws on missing failure", () => {
      const r = make();
      r.createProject(project);
      expect(() => r.convertFailureToRule(FA_ID, { title: "t", rule: "r", severity: "info" }, clock)).toThrowError(/failed_attempt_not_found|does not exist/);
    });
  });
}

suite("in-memory", () => createInMemoryCoreRegistry());

describe("json-directory", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "reg-p5-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  suite("json", () => createJsonDirectoryCoreRegistry({ rootDir: root }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test registry-forge`
Expected: FAIL — methods not on `CoreRegistry`.

- [ ] **Step 3a: Extend the interface (`registry.ts`)**

Add imports:

```ts
import {
  type FailedAttempt,
  type FailedAttemptPatch,
  failedAttemptPatchSchema,
  failedAttemptSchema,
  seedFailureEvidence,
} from "./failed-attempt.js";
import { searchFailedAttempts as searchFailures } from "./failed-attempt-search.js";
import type { FailedAttemptSearchQuery } from "./failed-attempt-search.js";
import {
  type FailureToRuleInput,
  type ProjectRule,
  failureToRuleInputSchema,
  projectRuleSchema,
} from "./project-rule.js";
```

(Adjust the existing `failed-attempt.js` / `project-rule.js` import lines to include the new names rather than duplicating import statements.)

Add a result type and the three interface methods (after `listFailedAttempts`):

```ts
export type ConvertFailureResult = { rule: ProjectRule; failure: FailedAttempt };

  updateFailedAttempt(id: FailedAttemptId, patch: FailedAttemptPatch): FailedAttempt;
  searchFailedAttempts(projectId: ProjectId, query: FailedAttemptSearchQuery): FailedAttempt[];
  convertFailureToRule(
    failureId: FailedAttemptId,
    input: FailureToRuleInput,
    clock: { now: () => string; newId: () => string },
  ): ConvertFailureResult;
```

- [ ] **Step 3b: In-memory impl (`registry.ts`, after `listFailedAttempts`)**

```ts
    updateFailedAttempt(id, patch) {
      const parsedPatch = failedAttemptPatchSchema.parse(patch);
      const existing = failedAttempts.get(id);
      if (!existing) {
        throw new CoreRegistryError("failed_attempt_not_found", `Failed attempt does not exist: ${id}`);
      }
      const updated = failedAttemptSchema.parse({ ...existing, ...parsedPatch });
      failedAttempts.set(id, updated);
      return updated;
    },

    searchFailedAttempts(projectId, query) {
      requireProject(projectId);
      const attempts = Array.from(failedAttempts.values())
        .filter((a) => a.projectId === projectId)
        .map((a) => failedAttemptSchema.parse(a));
      return searchFailures(attempts, query);
    },

    convertFailureToRule(failureId, input, clock) {
      const parsedInput = failureToRuleInputSchema.parse(input);
      const failure = failedAttempts.get(failureId);
      if (!failure) {
        throw new CoreRegistryError("failed_attempt_not_found", `Failed attempt does not exist: ${failureId}`);
      }
      if (failure.convertedToRule) {
        throw new CoreRegistryError("failed_attempt_already_converted", `Failed attempt already converted: ${failureId}`);
      }
      const rule = projectRuleSchema.parse({
        id: clock.newId(),
        projectId: failure.projectId,
        title: parsedInput.title,
        rule: parsedInput.rule,
        appliesTo: parsedInput.appliesTo ?? failure.relatedFiles,
        evidence: [...(parsedInput.evidence ?? []), seedFailureEvidence(failure)],
        severity: parsedInput.severity,
        confidence: parsedInput.confidence ?? "medium",
        createdFrom: "failed_attempt",
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });
      if (projectRules.has(rule.id)) {
        throw new CoreRegistryError("project_rule_already_exists", `Project rule already exists: ${rule.id}`);
      }
      projectRules.set(rule.id, rule);
      const updatedFailure = failedAttemptSchema.parse({ ...failure, convertedToRule: true });
      failedAttempts.set(failureId, updatedFailure);
      return { rule, failure: updatedFailure };
    },
```

- [ ] **Step 3c: Json impl (`json-directory-registry.ts`, after `listFailedAttempts`)**

Add imports (extend existing `failed-attempt.js` / `project-rule.js` import lines):

```ts
import {
  type FailedAttempt,
  failedAttemptPatchSchema,
  failedAttemptSchema,
  seedFailureEvidence,
} from "./failed-attempt.js";
import { searchFailedAttempts as searchFailures } from "./failed-attempt-search.js";
import { failureToRuleInputSchema, projectRuleSchema } from "./project-rule.js";
```

> **Critical:** `convertFailureToRule` and `updateFailedAttempt` must do their store reads/writes INLINE inside a single `withDirLock`. Do NOT call the public lock-taking methods (`createProjectRule`, `updateFailedAttempt`) from inside another `withDirLock` — the dir lock is not re-entrant and would deadlock until timeout.

```ts
    updateFailedAttempt(id, patch) {
      const parsedPatch = failedAttemptPatchSchema.parse(patch);
      return withDirLock(options.rootDir, () => {
        const existing = readAllFailedAttempts(paths).find((f) => f.id === id);
        if (!existing) {
          throw new CoreRegistryError("failed_attempt_not_found", `Failed attempt does not exist: ${id}`);
        }
        const updated = failedAttemptSchema.parse({ ...existing, ...parsedPatch });
        const next = readFailedAttemptsForProject(paths, existing.projectId).map((f) =>
          f.id === id ? updated : f,
        );
        writeFailedAttemptsForProject(paths, existing.projectId, next);
        return updated;
      });
    },

    searchFailedAttempts(projectId, query) {
      requireProject(projectId);
      const attempts = readFailedAttemptsForProject(paths, projectId).map((a) =>
        failedAttemptSchema.parse(a),
      );
      return searchFailures(attempts, query);
    },

    convertFailureToRule(failureId, input, clock) {
      const parsedInput = failureToRuleInputSchema.parse(input);
      return withDirLock(options.rootDir, () => {
        const failure = readAllFailedAttempts(paths).find((f) => f.id === failureId);
        if (!failure) {
          throw new CoreRegistryError("failed_attempt_not_found", `Failed attempt does not exist: ${failureId}`);
        }
        if (failure.convertedToRule) {
          throw new CoreRegistryError("failed_attempt_already_converted", `Failed attempt already converted: ${failureId}`);
        }
        const rule = projectRuleSchema.parse({
          id: clock.newId(),
          projectId: failure.projectId,
          title: parsedInput.title,
          rule: parsedInput.rule,
          appliesTo: parsedInput.appliesTo ?? failure.relatedFiles,
          evidence: [...(parsedInput.evidence ?? []), seedFailureEvidence(failure)],
          severity: parsedInput.severity,
          confidence: parsedInput.confidence ?? "medium",
          createdFrom: "failed_attempt",
          createdAt: clock.now(),
          updatedAt: clock.now(),
        });
        if (readAllProjectRules(paths).some((r) => r.id === rule.id)) {
          throw new CoreRegistryError("project_rule_already_exists", `Project rule already exists: ${rule.id}`);
        }
        writeProjectRulesForProject(paths, rule.projectId, [
          ...readProjectRulesForProject(paths, rule.projectId),
          rule,
        ]);
        const updatedFailure = failedAttemptSchema.parse({ ...failure, convertedToRule: true });
        const nextFailures = readFailedAttemptsForProject(paths, failure.projectId).map((f) =>
          f.id === failureId ? updatedFailure : f,
        );
        writeFailedAttemptsForProject(paths, failure.projectId, nextFailures);
        return { rule, failure: updatedFailure };
      });
    },
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @megasaver/core test registry-forge && pnpm --filter @megasaver/core typecheck`
Expected: PASS (12 tests: 6 × in-memory + 6 × json); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry.ts packages/core/src/json-directory-registry.ts packages/core/test/registry-forge.test.ts
git commit -m "feat(core): updateFailedAttempt + searchFailedAttempts + convertFailureToRule (both impls)"
```

---

## Task 6: Core barrel exports

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/index-forge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("core barrel (phase 5)", () => {
  it("re-exports the forge surface", () => {
    expect(core.searchFailedAttempts).toBeDefined();
    expect(core.rankApplicableRules).toBeDefined();
    expect(core.failureToRuleInputSchema).toBeDefined();
    expect(core.failedAttemptPatchSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test index-forge`
Expected: FAIL.

- [ ] **Step 3: Add exports**

Add to `packages/core/src/index.ts`:

```ts
export * from "./failed-attempt-search.js";
export * from "./project-rule-ranking.js";
```

(`failedAttemptPatchSchema`/`seedFailureEvidence` come via the existing `./failed-attempt.js` export; `failureToRuleInputSchema` via `./project-rule.js`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test index-forge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index-forge.test.ts
git commit -m "feat(core): export forge ranking modules from barrel"
```

---

## Task 7: MCP tool — find_similar_failures

**Files:**
- Create: `packages/mcp-bridge/src/tools/find-similar-failures.ts`
- Test: `packages/mcp-bridge/test/tools/forge-tools.test.ts` (created here; extended in Tasks 8–9)

- [ ] **Step 1: Write the failing test**

```ts
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleFindSimilarFailures } from "../../src/tools/find-similar-failures.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-12T00:00:00.000Z";

function seeded(): CoreRegistry {
  const r = createInMemoryCoreRegistry();
  r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
  r.createFailedAttempt({
    id: "a0000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    sessionId: null,
    task: "fix login auth bug",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
  });
  return r;
}

describe("find_similar_failures", () => {
  it("returns ranked failures for a task", async () => {
    const res = await handleFindSimilarFailures({ registry: seeded() }, { projectId: PROJECT_ID, task: "login auth" });
    expect(res.failures).toHaveLength(1);
  });
  it("rejects unknown project as resource_not_found", async () => {
    await expect(
      handleFindSimilarFailures({ registry: seeded() }, { projectId: "99999999-9999-4999-8999-999999999999", task: "x" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
  it("rejects invalid input as validation_failed", async () => {
    await expect(handleFindSimilarFailures({ registry: seeded() }, { projectId: PROJECT_ID })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test forge-tools`
Expected: FAIL — module missing. (Build core first if `@megasaver/core` won't resolve: `pnpm --filter @megasaver/core build`.)

- [ ] **Step 3: Write the handler**

```ts
import { type CoreRegistry, CoreRegistryError, type FailedAttempt } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type FindSimilarFailuresEnv = { registry: CoreRegistry };

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    limit: z.number().int().positive().optional(),
    includeConverted: z.boolean().optional(),
  })
  .strict();

export type FindSimilarFailuresResult = { failures: readonly FailedAttempt[] };

export async function handleFindSimilarFailures(
  env: FindSimilarFailuresEnv,
  rawArgs: unknown,
): Promise<FindSimilarFailuresResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, limit, includeConverted } = parsed.data;
  try {
    const failures = env.registry.searchFailedAttempts(projectId as ProjectId, {
      text: task,
      ...(limit !== undefined ? { limit } : {}),
      ...(includeConverted !== undefined ? { includeConverted } : {}),
    });
    return { failures };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test forge-tools`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/find-similar-failures.ts packages/mcp-bridge/test/tools/forge-tools.test.ts
git commit -m "feat(mcp-bridge): find_similar_failures tool"
```

---

## Task 8: MCP tool — get_applicable_rules

**Files:**
- Create: `packages/mcp-bridge/src/tools/get-applicable-rules.ts`
- Modify: `packages/mcp-bridge/test/tools/forge-tools.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add import at top of `forge-tools.test.ts`:

```ts
import { handleGetApplicableRules } from "../../src/tools/get-applicable-rules.js";
```

Append:

```ts
describe("get_applicable_rules", () => {
  it("returns scored rules with reasons", async () => {
    const r = createInMemoryCoreRegistry();
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    r.createProjectRule({
      id: "b0000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      title: "Migrate first",
      rule: "create a migration before regenerating",
      appliesTo: ["prisma/schema.prisma"],
      evidence: [],
      severity: "warning",
      confidence: "high",
      createdFrom: "manual",
      createdAt: TS,
      updatedAt: TS,
    });
    const res = await handleGetApplicableRules({ registry: r }, { projectId: PROJECT_ID, files: ["prisma/schema.prisma"] });
    expect(res.rules).toHaveLength(1);
    expect(res.rules[0]?.reason).toContain("applies to");
  });
  it("rejects unknown project as resource_not_found", async () => {
    const r = createInMemoryCoreRegistry();
    await expect(handleGetApplicableRules({ registry: r }, { projectId: PROJECT_ID })).rejects.toMatchObject({
      code: "resource_not_found",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test forge-tools`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the handler**

```ts
import { type CoreRegistry, CoreRegistryError, type RankedRule, rankApplicableRules } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetApplicableRulesEnv = { registry: CoreRegistry };

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1).optional(),
    files: z.array(z.string()).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type GetApplicableRulesResult = { rules: readonly RankedRule[] };

export async function handleGetApplicableRules(
  env: GetApplicableRulesEnv,
  rawArgs: unknown,
): Promise<GetApplicableRulesResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, files, limit } = parsed.data;
  try {
    const all = env.registry.listProjectRules(projectId as ProjectId);
    const rules = rankApplicableRules(all, {
      ...(task !== undefined ? { task } : {}),
      ...(files !== undefined ? { files } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return { rules };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test forge-tools`
Expected: PASS (3 prior + 2 new = 5).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/get-applicable-rules.ts packages/mcp-bridge/test/tools/forge-tools.test.ts
git commit -m "feat(mcp-bridge): get_applicable_rules scored tool"
```

---

## Task 9: MCP tool — convert_failure_to_rule

**Files:**
- Create: `packages/mcp-bridge/src/tools/convert-failure-to-rule.ts`
- Modify: `packages/mcp-bridge/test/tools/forge-tools.test.ts` (append)

- [ ] **Step 1: Append the failing test**

Add import:

```ts
import { handleConvertFailureToRule } from "../../src/tools/convert-failure-to-rule.js";
```

Append:

```ts
describe("convert_failure_to_rule", () => {
  const FA_ID = "a0000000-0000-4000-8000-000000000001";
  const RULE_ID = "c0000000-0000-4000-8000-000000000001";
  function seededWithFailure(): CoreRegistry {
    const r = createInMemoryCoreRegistry();
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    r.createFailedAttempt({
      id: FA_ID, projectId: PROJECT_ID, sessionId: null, task: "t", failedStep: "s",
      relatedFiles: ["src/db.ts"], convertedToRule: false, createdAt: TS,
    });
    return r;
  }
  const env = (r: CoreRegistry) => ({ registry: r, now: () => TS, newId: () => RULE_ID });

  it("converts a failure into a rule and flips it", async () => {
    const r = seededWithFailure();
    const res = await handleConvertFailureToRule(env(r), { failureId: FA_ID, title: "Migrate", rule: "migrate first", severity: "warning" });
    expect(res).toEqual({ ruleId: RULE_ID, failureId: FA_ID });
    expect(r.getProjectRule(RULE_ID as never)?.createdFrom).toBe("failed_attempt");
    expect(r.getFailedAttempt(FA_ID as never)?.convertedToRule).toBe(true);
  });
  it("rejects an unknown failure as resource_not_found", async () => {
    const r = seededWithFailure();
    await expect(
      handleConvertFailureToRule(env(r), { failureId: "a0000000-0000-4000-8000-000000000009", title: "t", rule: "r", severity: "info" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
  it("rejects a double-convert as validation_failed", async () => {
    const r = seededWithFailure();
    await handleConvertFailureToRule(env(r), { failureId: FA_ID, title: "t", rule: "r", severity: "info" });
    await expect(
      handleConvertFailureToRule({ registry: r, now: () => TS, newId: () => "c0000000-0000-4000-8000-000000000002" }, { failureId: FA_ID, title: "t", rule: "r", severity: "info" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test forge-tools`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the handler**

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  ruleConfidenceSchema,
  ruleSeveritySchema,
} from "@megasaver/core";
import { failedAttemptIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ConvertFailureToRuleEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};

const inputSchema = z
  .object({
    failureId: z.string().min(1),
    title: z.string().min(1),
    rule: z.string().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
  })
  .strict();

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "failed_attempt_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    // already_converted, project_rule_already_exists, project_not_found
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "convert_failure_to_rule failed");
}

export async function handleConvertFailureToRule(
  env: ConvertFailureToRuleEnv,
  rawArgs: unknown,
): Promise<{ ruleId: string; failureId: string }> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;
  const failureId = failedAttemptIdSchema.safeParse(d.failureId);
  if (!failureId.success) {
    throw new McpBridgeError("validation_failed", `invalid failureId: ${d.failureId}`);
  }
  try {
    const { rule, failure } = env.registry.convertFailureToRule(
      failureId.data,
      {
        title: d.title,
        rule: d.rule,
        severity: d.severity,
        ...(d.confidence !== undefined ? { confidence: d.confidence } : {}),
        ...(d.appliesTo !== undefined ? { appliesTo: d.appliesTo } : {}),
        ...(d.evidence !== undefined ? { evidence: d.evidence } : {}),
      },
      { now: env.now, newId: env.newId },
    );
    return { ruleId: rule.id, failureId: failure.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test forge-tools`
Expected: PASS (5 prior + 3 new = 8).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/convert-failure-to-rule.ts packages/mcp-bridge/test/tools/forge-tools.test.ts
git commit -m "feat(mcp-bridge): convert_failure_to_rule tool"
```

---

## Task 10: Wire 3 tools into the enum + server

**Files:**
- Modify: `packages/mcp-bridge/src/tool-name.ts`, `packages/mcp-bridge/test/tool-name.test-d.ts`
- Modify: `packages/mcp-bridge/src/server.ts`
- Test: `packages/mcp-bridge/test/tool-name-forge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mcpToolNameSchema } from "../src/tool-name.js";

describe("tool-name enum (phase 5)", () => {
  it("is a closed set of 18 alphabetically-ordered names", () => {
    expect(mcpToolNameSchema.options).toEqual([
      "convert_failure_to_rule",
      "explain_context_selection",
      "find_similar_failures",
      "get_applicable_rules",
      "get_context_budget_report",
      "get_project_context",
      "get_project_rules",
      "get_relevant_code_blocks",
      "get_relevant_context",
      "get_relevant_memories",
      "mega_fetch_chunk",
      "mega_read_file",
      "mega_recall",
      "mega_run_command",
      "record_failed_attempt",
      "save_memory",
      "save_project_rule",
      "search_memory",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name-forge`
Expected: FAIL — 15 names.

- [ ] **Step 3a: Replace the enum (`tool-name.ts`)** with the 18-name list above (same order); update the leading comment to mention the Phase 5 FORGE tools (`convert_failure_to_rule`, `find_similar_failures`, `get_applicable_rules`).

- [ ] **Step 3b: Update `test/tool-name.test-d.ts`** — the type-level tuple pinned to the member count. Add the 3 new names in their alphabetic positions so the tuple has 18 members matching the enum (same edit shape as the Phase 4 11→15 change).

- [ ] **Step 3c: Import handlers in `server.ts`**

```ts
import { handleConvertFailureToRule } from "./tools/convert-failure-to-rule.js";
import { handleFindSimilarFailures } from "./tools/find-similar-failures.js";
import { handleGetApplicableRules } from "./tools/get-applicable-rules.js";
```

- [ ] **Step 3d: Add `TOOL_DEFS` rows** (keep alphabetic: `convert_failure_to_rule` first; `find_similar_failures` after `explain_context_selection`; `get_applicable_rules` after `find_similar_failures`)

```ts
  { name: "convert_failure_to_rule", description: "Convert a failed attempt into a reusable project rule." },
  { name: "find_similar_failures", description: "Rank past failed attempts similar to a task." },
  { name: "get_applicable_rules", description: "Score project rules applicable to a task or files." },
```

- [ ] **Step 3e: Add dispatch cases** in the `switch (toolName)`

```ts
      case "convert_failure_to_rule":
        return handleConvertFailureToRule({ registry: deps.registry, now, newId }, args);
      case "find_similar_failures":
        return handleFindSimilarFailures({ registry: deps.registry }, args);
      case "get_applicable_rules":
        return handleGetApplicableRules({ registry: deps.registry }, args);
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name-forge && pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: PASS; typecheck clean (dispatch switch exhaustive over 18 names).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/test/tool-name.test-d.ts packages/mcp-bridge/src/server.ts packages/mcp-bridge/test/tool-name-forge.test.ts
git commit -m "feat(mcp-bridge): wire 3 Phase 5 FORGE tools (15 -> 18)"
```

---

## Task 11: Server e2e — 18 tools + FORGE round-trip

**Files:**
- Modify: `packages/mcp-bridge/test/server.e2e.test.ts`

- [ ] **Step 1: Append the failing test**

```ts
describe("phase 5 FORGE tools over the bridge", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-p5-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-p5-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function connectP5() {
    const { server } = buildServer({
      registry: seededRegistry(projectRoot),
      storeRoot: store,
      now: () => TS,
      newId: () => "e0000000-0000-4000-8000-000000000001",
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { client, server };
  }

  it("lists 18 tools", async () => {
    const { client, server } = await connect(projectRoot, store);
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(18);
    expect(tools.map((t) => t.name)).toContain("convert_failure_to_rule");
    await server.close();
  });

  it("record -> find_similar -> convert -> get_applicable round-trips", async () => {
    const { client, server } = await connectP5();
    await client.callTool({
      name: "record_failed_attempt",
      arguments: { projectId: PROJECT_ID, task: "fix login auth bug", failedStep: "run auth tests", relatedFiles: ["src/auth.ts"] },
    });
    const sim = (await client.callTool({
      name: "find_similar_failures",
      arguments: { projectId: PROJECT_ID, task: "login auth" },
    })) as { content: { text: string }[] };
    const simPayload = JSON.parse(sim.content[0]?.text ?? "{}") as { failures: { id: string }[] };
    expect(simPayload.failures).toHaveLength(1);

    await client.callTool({
      name: "convert_failure_to_rule",
      arguments: { failureId: "e0000000-0000-4000-8000-000000000001", title: "Guard auth", rule: "check expiry with <=", severity: "warning" },
    });
    const applic = (await client.callTool({
      name: "get_applicable_rules",
      arguments: { projectId: PROJECT_ID, files: ["src/auth.ts"] },
    })) as { content: { text: string }[] };
    const applicPayload = JSON.parse(applic.content[0]?.text ?? "{}") as { rules: unknown[] };
    expect(applicPayload.rules).toHaveLength(1);
    await server.close();
  });
});
```

> The shared `connect`/`seededRegistry`/`PROJECT_ID`/`TS` helpers already exist at the top of this file. `connectP5` is local because the FORGE round-trip mints entity ids via the server `newId`, which must be a valid uuid (the shared `connect` uses `"cs-e2e"`). The failure and rule share one id here — different entity types/stores, no collision.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: FAIL on "lists 18 tools" (currently 15) until Task 10 lands; with Task 10 done, the round-trip exercises the new tools.

- [ ] **Step 3: (no production change)** — Task 10 already wired the tools; this task is test-only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/test/server.e2e.test.ts
git commit -m "test(mcp-bridge): e2e 18-tool surface + FORGE round-trip"
```

---

## Task 12: CLI — `mega fail` (record/list/show)

**Files:**
- Create: `apps/cli/src/commands/fail/{shared,record,list,show,index}.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/fail.test.ts`

All leaves follow the `apps/cli/src/commands/memory/create.ts` pattern: a `run<Name>(input)` function returning `Promise<0 | 1>` that resolves the store (`resolveStorePath`/`readStoreEnv`), looks up the project by name, calls the registry, and writes via injected `stdout`/`stderr`; plus a `defineCommand` wrapper. Reuse existing helpers from `../../errors.js` (`mapErrorToCliMessage`, `projectNotFoundMessage`) and `../../store.js` (`ensureStoreReady`, `resolveStorePath`, `readStoreEnv`). The generic `mapErrorToCliMessage` branch renders `CoreRegistryError` as `error: <code>: <message>`, so no new error helpers are needed.

- [ ] **Step 1: Write the failing test** (`apps/cli/test/fail.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFailRecord } from "../src/commands/fail/record.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";

function baseInput(root: string, out: string[], err: string[]) {
  return {
    projectName: "demo",
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    now: () => TS,
  };
}

describe("mega fail record", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-fail-"));
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records a failure and prints its id", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runFailRecord({ ...baseInput(root, out, err), taskFlag: "fix login", failedStepFlag: "auth test", newId: () => "a0000000-0000-4000-8000-000000000001" });
    expect(code).toBe(0);
    expect(out[0]).toBe("a0000000-0000-4000-8000-000000000001");
  });

  it("warns when a similar prior failure exists", async () => {
    const out: string[] = [];
    const err: string[] = [];
    await runFailRecord({ ...baseInput(root, out, err), taskFlag: "fix login auth", failedStepFlag: "auth test", newId: () => "a0000000-0000-4000-8000-000000000001" });
    await runFailRecord({ ...baseInput(root, out, err), taskFlag: "fix login auth again", failedStepFlag: "auth test", newId: () => "a0000000-0000-4000-8000-000000000002" });
    expect(err.some((l) => l.toLowerCase().includes("similar"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test fail`
Expected: FAIL — module missing.

- [ ] **Step 3a: `fail/shared.ts`**

```ts
import type { FailedAttempt } from "@megasaver/core";
import { failedAttemptIdSchema } from "@megasaver/shared";

export { failedAttemptIdSchema };

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatFailureLine(f: Pick<FailedAttempt, "id" | "task" | "convertedToRule">): string {
  return `${f.id}  ${f.convertedToRule ? "[converted]" : "[open]     "}  ${f.task}`;
}

export function formatFailureShow(f: FailedAttempt): string[] {
  return [
    `id          ${f.id}`,
    `project     ${f.projectId}`,
    `task        ${f.task}`,
    `failedStep  ${f.failedStep}`,
    `error       ${f.errorOutput ?? "-"}`,
    `cause       ${f.suspectedCause ?? "-"}`,
    `resolution  ${f.resolution ?? "-"}`,
    `files       ${f.relatedFiles.length > 0 ? f.relatedFiles.join(", ") : "-"}`,
    `converted   ${f.convertedToRule}`,
    `createdAt   ${f.createdAt}`,
  ];
}
```

- [ ] **Step 3b: `fail/record.ts`**

```ts
import { type FailedAttempt, failedAttemptSchema } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { toStringArray } from "./shared.js";

export type RunFailRecordInput = {
  projectName: string;
  taskFlag: string;
  failedStepFlag: string;
  sessionFlag?: string | undefined;
  errorFlag?: string | undefined;
  causeFlag?: string | undefined;
  fileFlags?: unknown;
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

export async function runFailRecord(input: RunFailRecordInput): Promise<0 | 1> {
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

  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse> | null = null;
  if (input.sessionFlag !== undefined) {
    try {
      parsedSessionId = sessionIdSchema.parse(input.sessionFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
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

    // Warn before recording when a similar prior failure exists (roadmap exit criterion).
    const similar = registry.searchFailedAttempts(project.id, { text: input.taskFlag, limit: 3 });
    for (const s of similar) {
      input.stderr(`warning: similar previous failure ${s.id}: ${s.failedStep}`);
    }

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_FAILED_ATTEMPT_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const relatedFiles = toStringArray(input.fileFlags);

    const attempt: FailedAttempt = failedAttemptSchema.parse({
      id,
      projectId: project.id,
      sessionId: parsedSessionId,
      task: input.taskFlag,
      failedStep: input.failedStepFlag,
      relatedFiles,
      convertedToRule: false,
      createdAt,
      ...(input.errorFlag !== undefined ? { errorOutput: input.errorFlag } : {}),
      ...(input.causeFlag !== undefined ? { suspectedCause: input.causeFlag } : {}),
    });

    const created = registry.createFailedAttempt(attempt);
    input.stdout(input.json ? JSON.stringify(created) : created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const failRecordCommand = defineCommand({
  meta: { name: "record", description: "Record a failed attempt on a project." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name (must exist)." },
    task: { type: "string", required: true, description: "What was being attempted." },
    "failed-step": { type: "string", required: true, description: "The step that failed." },
    session: { type: "string", description: "Session id (UUID)." },
    error: { type: "string", description: "Error output." },
    cause: { type: "string", description: "Suspected cause." },
    file: { type: "string", description: "Related file path (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runFailRecord({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : "",
      failedStepFlag: typeof args["failed-step"] === "string" ? (args["failed-step"] as string) : "",
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      errorFlag: typeof args.error === "string" ? args.error : undefined,
      causeFlag: typeof args.cause === "string" ? args.cause : undefined,
      fileFlags: args.file,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3c: `fail/list.ts`** — `runFailList(input)` resolves store + project, then `registry.listFailedAttempts(project.id)`, printing `formatFailureLine` per row (or `JSON.stringify` when `--json`). `defineCommand` `failListCommand` with `projectName` positional + `store`/`json` flags. Mirror `apps/cli/src/commands/memory/list.ts` structure exactly, substituting the failure list + formatter.

```ts
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatFailureLine } from "./shared.js";

export type RunFailListInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void; json?: boolean;
};

export async function runFailList(input: RunFailListInput): Promise<0 | 1> {
  let rootDir: string;
  try { rootDir = resolveStorePath(input); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" }); input.stderr(cli.message); return cli.exitCode;
  }
  let projectName: string;
  try { projectName = projectNameSchema.parse(input.projectName); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" }); input.stderr(cli.message); return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) { const cli = projectNotFoundMessage(projectName); input.stderr(cli.message); return cli.exitCode; }
    const failures = registry.listFailedAttempts(project.id);
    if (input.json) input.stdout(JSON.stringify(failures));
    else for (const f of failures) input.stdout(formatFailureLine(f));
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" }); input.stderr(cli.message); return cli.exitCode;
  }
}

export const failListCommand = defineCommand({
  meta: { name: "list", description: "List failed attempts on a project." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runFailList({
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

- [ ] **Step 3d: `fail/show.ts`** — `runFailShow(input)` takes an `idFlag`, parses it with `failedAttemptIdSchema`, calls `registry.getFailedAttempt(id)`; if null, print `error: failed attempt not found` to stderr and return 1; else print `formatFailureShow` lines (or JSON). `defineCommand` `failShowCommand` with an `id` positional + `store`/`json`.

```ts
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { failedAttemptIdSchema, formatFailureShow } from "./shared.js";

export type RunFailShowInput = {
  idFlag: string;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void; json?: boolean;
};

export async function runFailShow(input: RunFailShowInput): Promise<0 | 1> {
  let rootDir: string;
  try { rootDir = resolveStorePath(input); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" }); input.stderr(cli.message); return cli.exitCode;
  }
  let id: ReturnType<typeof failedAttemptIdSchema.parse>;
  try { id = failedAttemptIdSchema.parse(input.idFlag); } catch {
    input.stderr(`error: invalid failed attempt id "${input.idFlag}"`); return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const found = registry.getFailedAttempt(id);
    if (!found) { input.stderr("error: failed attempt not found"); return 1; }
    if (input.json) input.stdout(JSON.stringify(found));
    else for (const line of formatFailureShow(found)) input.stdout(line);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" }); input.stderr(cli.message); return cli.exitCode;
  }
}

export const failShowCommand = defineCommand({
  meta: { name: "show", description: "Show a failed attempt by id." },
  args: {
    id: { type: "positional", required: true, description: "Failed attempt id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runFailShow({
      idFlag: typeof args.id === "string" ? args.id : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3e: `fail/index.ts`**

```ts
import { defineCommand } from "citty";
import { failListCommand } from "./list.js";
import { failRecordCommand } from "./record.js";
import { failShowCommand } from "./show.js";

export { type RunFailRecordInput, runFailRecord, failRecordCommand } from "./record.js";
export { type RunFailListInput, runFailList, failListCommand } from "./list.js";
export { type RunFailShowInput, runFailShow, failShowCommand } from "./show.js";

export const failCommand = defineCommand({
  meta: { name: "fail", description: "Record and inspect failed attempts." },
  subCommands: { record: failRecordCommand, list: failListCommand, show: failShowCommand },
});
```

- [ ] **Step 3f: Register in `main.ts`** — `import { failCommand } from "./commands/fail/index.js";` and add `fail: failCommand,` to `subCommands`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test fail`
Expected: PASS (2 tests). Build core first if needed.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/fail apps/cli/src/main.ts apps/cli/test/fail.test.ts
git commit -m "feat(cli): mega fail record/list/show with similar-failure warning"
```

---

## Task 13: CLI — `mega rules` (list/add/apply)

**Files:**
- Create: `apps/cli/src/commands/rules/{shared,list,add,apply,index}.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/rules.test.ts`

- [ ] **Step 1: Write the failing test** (`apps/cli/test/rules.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRulesAdd } from "../src/commands/rules/add.js";
import { runRulesApply } from "../src/commands/rules/apply.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";

function base(root: string, out: string[], err: string[]) {
  return {
    projectName: "demo", storeFlag: root, cwd: root, home: root,
    xdgDataHome: undefined, platform: process.platform, localAppData: undefined,
    stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l), now: () => TS,
  };
}

describe("mega rules add + apply", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-rules-"));
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("adds a rule then applies it by files", async () => {
    const out: string[] = []; const err: string[] = [];
    await runRulesAdd({ ...base(root, out, err), titleFlag: "Migrate first", ruleFlag: "create a migration", severityFlag: "warning", appliesToFlags: ["prisma/"], newId: () => "b0000000-0000-4000-8000-000000000001" });
    const applyOut: string[] = []; const applyErr: string[] = [];
    const code = await runRulesApply({ ...base(root, applyOut, applyErr), taskFlag: undefined, filesFlags: ["prisma/schema.prisma"] });
    expect(code).toBe(0);
    expect(applyOut.join("\n")).toContain("Migrate first");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test rules`
Expected: FAIL — modules missing.

- [ ] **Step 3a: `rules/shared.ts`**

```ts
import type { ProjectRule } from "@megasaver/core";
import { projectRuleIdSchema } from "@megasaver/shared";

export { projectRuleIdSchema };

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatRuleLine(r: Pick<ProjectRule, "id" | "severity" | "title">): string {
  return `${r.id}  ${r.severity.padEnd(8, " ")}  ${r.title}`;
}

export function formatRankedRuleLine(ranked: { rule: Pick<ProjectRule, "id" | "severity" | "title">; score: number; reason: string }): string {
  return `${ranked.rule.id}  ${ranked.rule.severity.padEnd(8, " ")}  score=${ranked.score}  ${ranked.rule.title}  (${ranked.reason})`;
}
```

- [ ] **Step 3b: `rules/add.ts`** — `runRulesAdd(input)`: resolve store + project; build a `ProjectRule` via `projectRuleSchema.parse` with `id = readTestEnv("MEGA_TEST_PROJECT_RULE_ID") ?? newId()`, `createdFrom: "manual"`, `createdAt = updatedAt = now`, `severity` validated with `ruleSeveritySchema.safeParse` (print `error: invalid severity "<v>"` + return 1 on failure), `confidence` defaulting `"medium"`, `appliesTo`/`evidence` via `toStringArray`; `registry.createProjectRule(rule)`; print id. `defineCommand` `rulesAddCommand` with `projectName` positional, `--title --rule --severity [--applies-to (repeatable) --evidence (repeatable) --confidence]` + `store`/`json`. Mirror `fail/record.ts` shape.

```ts
import { type ProjectRule, projectRuleSchema, ruleConfidenceSchema, ruleSeveritySchema } from "@megasaver/core";
import { titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { toStringArray } from "./shared.js";

export type RunRulesAddInput = {
  projectName: string;
  titleFlag: string;
  ruleFlag: string;
  severityFlag: string;
  confidenceFlag?: string | undefined;
  appliesToFlags?: unknown;
  evidenceFlags?: unknown;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void; json?: boolean;
  newId?: () => string; now?: () => string;
};

export async function runRulesAdd(input: RunRulesAddInput): Promise<0 | 1> {
  let rootDir: string;
  try { rootDir = resolveStorePath(input); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" }); input.stderr(cli.message); return cli.exitCode;
  }
  let projectName: string;
  try { projectName = projectNameSchema.parse(input.projectName); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" }); input.stderr(cli.message); return cli.exitCode;
  }
  const severity = ruleSeveritySchema.safeParse(input.severityFlag);
  if (!severity.success) { input.stderr(`error: invalid severity "${input.severityFlag}"`); return 1; }
  const confidence = ruleConfidenceSchema.safeParse(input.confidenceFlag ?? "medium");
  if (!confidence.success) { input.stderr(`error: invalid confidence "${input.confidenceFlag ?? ""}"`); return 1; }
  let title: string;
  try { title = titleSchema.parse(input.titleFlag); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "title" }); input.stderr(cli.message); return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) { const cli = projectNotFoundMessage(projectName); input.stderr(cli.message); return cli.exitCode; }
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_PROJECT_RULE_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const rule: ProjectRule = projectRuleSchema.parse({
      id, projectId: project.id, title, rule: input.ruleFlag,
      appliesTo: toStringArray(input.appliesToFlags), evidence: toStringArray(input.evidenceFlags),
      severity: severity.data, confidence: confidence.data, createdFrom: "manual",
      createdAt, updatedAt: createdAt,
    });
    const created = registry.createProjectRule(rule);
    input.stdout(input.json ? JSON.stringify(created) : created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" }); input.stderr(cli.message); return cli.exitCode;
  }
}

export const rulesAddCommand = defineCommand({
  meta: { name: "add", description: "Add a project rule." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    title: { type: "string", required: true, description: "Rule title." },
    rule: { type: "string", required: true, description: "Rule body." },
    severity: { type: "string", required: true, description: "info | warning | critical." },
    confidence: { type: "string", description: "low | medium | high; default medium." },
    "applies-to": { type: "string", description: "Path/glob (repeatable)." },
    evidence: { type: "string", description: "Evidence line (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runRulesAdd({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      titleFlag: typeof args.title === "string" ? args.title : "",
      ruleFlag: typeof args.rule === "string" ? args.rule : "",
      severityFlag: typeof args.severity === "string" ? args.severity : "",
      confidenceFlag: typeof args.confidence === "string" ? args.confidence : undefined,
      appliesToFlags: args["applies-to"],
      evidenceFlags: args.evidence,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3c: `rules/list.ts`** — `runRulesList(input)` resolves store + project, `registry.listProjectRules(project.id)`, prints `formatRuleLine` per row (or JSON). `rulesListCommand` with `projectName` positional + `store`/`json`. Mirror `fail/list.ts` exactly, substituting `listProjectRules` + `formatRuleLine`.

- [ ] **Step 3d: `rules/apply.ts`**

```ts
import { rankApplicableRules } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatRankedRuleLine, toStringArray } from "./shared.js";

export type RunRulesApplyInput = {
  projectName: string;
  taskFlag?: string | undefined;
  filesFlags?: unknown;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void; json?: boolean;
};

export async function runRulesApply(input: RunRulesApplyInput): Promise<0 | 1> {
  let rootDir: string;
  try { rootDir = resolveStorePath(input); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" }); input.stderr(cli.message); return cli.exitCode;
  }
  let projectName: string;
  try { projectName = projectNameSchema.parse(input.projectName); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" }); input.stderr(cli.message); return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) { const cli = projectNotFoundMessage(projectName); input.stderr(cli.message); return cli.exitCode; }
    const files = toStringArray(input.filesFlags);
    const ranked = rankApplicableRules(registry.listProjectRules(project.id), {
      ...(input.taskFlag !== undefined ? { task: input.taskFlag } : {}),
      files,
    });
    // Surface similar past failures as warnings when a task is given.
    if (input.taskFlag !== undefined) {
      for (const s of registry.searchFailedAttempts(project.id, { text: input.taskFlag, limit: 3 })) {
        input.stderr(`warning: similar previous failure ${s.id}: ${s.failedStep}`);
      }
    }
    if (input.json) input.stdout(JSON.stringify(ranked));
    else for (const r of ranked) input.stdout(formatRankedRuleLine(r));
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" }); input.stderr(cli.message); return cli.exitCode;
  }
}

export const rulesApplyCommand = defineCommand({
  meta: { name: "apply", description: "Show project rules applicable to a task/files." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    task: { type: "string", description: "Task text to match." },
    files: { type: "string", description: "File path (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runRulesApply({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : undefined,
      filesFlags: args.files,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3e: `rules/index.ts`** — group `rulesCommand` (`defineCommand`, `meta.name = "rules"`) with `subCommands: { list: rulesListCommand, add: rulesAddCommand, apply: rulesApplyCommand }`, re-exporting the `run*` functions + commands (same shape as `fail/index.ts`).

- [ ] **Step 3f: Register in `main.ts`** — `import { rulesCommand } from "./commands/rules/index.js";` and add `rules: rulesCommand,` to `subCommands`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test rules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/rules apps/cli/src/main.ts apps/cli/test/rules.test.ts
git commit -m "feat(cli): mega rules list/add/apply (scored)"
```

---

## Task 14: CLI — `mega learn from-failure`

**Files:**
- Create: `apps/cli/src/commands/learn.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/learn.test.ts`

- [ ] **Step 1: Write the failing test** (`apps/cli/test/learn.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { failedAttemptIdSchema, projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLearnFromFailure } from "../src/commands/learn.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const FA_ID = failedAttemptIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const TS = "2026-06-12T00:00:00.000Z";

describe("mega learn from-failure", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-learn-"));
    await initStore(root);
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    r.createFailedAttempt({ id: FA_ID, projectId: PROJECT_ID, sessionId: null, task: "t", failedStep: "s", relatedFiles: ["src/db.ts"], convertedToRule: false, createdAt: TS });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("converts a failure into a rule and prints the rule id", async () => {
    const out: string[] = []; const err: string[] = [];
    const code = await runLearnFromFailure({
      idFlag: FA_ID, titleFlag: "Migrate first", ruleFlag: "create migration", severityFlag: "warning",
      storeFlag: root, cwd: root, home: root, xdgDataHome: undefined, platform: process.platform, localAppData: undefined,
      stdout: (l) => out.push(l), stderr: (l) => err.push(l),
      now: () => TS, newId: () => "c0000000-0000-4000-8000-000000000001",
    });
    expect(code).toBe(0);
    expect(out[0]).toContain("c0000000-0000-4000-8000-000000000001");
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(r.getFailedAttempt(FA_ID)?.convertedToRule).toBe(true);
  });

  it("rejects a double-convert", async () => {
    const mk = () => ({
      idFlag: FA_ID, titleFlag: "t", ruleFlag: "r", severityFlag: "info",
      storeFlag: root, cwd: root, home: root, xdgDataHome: undefined, platform: process.platform, localAppData: undefined,
      stdout: (_l: string) => {}, stderr: (_l: string) => {}, now: () => TS,
    });
    await runLearnFromFailure({ ...mk(), newId: () => "c0000000-0000-4000-8000-000000000001" });
    const err: string[] = [];
    const code = await runLearnFromFailure({ ...mk(), stderr: (l) => err.push(l), newId: () => "c0000000-0000-4000-8000-000000000002" });
    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("already converted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test learn`
Expected: FAIL — module missing.

- [ ] **Step 3a: `learn.ts`**

```ts
import { ruleSeveritySchema } from "@megasaver/core";
import { failedAttemptIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";
import { toStringArray } from "./fail/shared.js";

export type RunLearnFromFailureInput = {
  idFlag: string;
  titleFlag: string;
  ruleFlag: string;
  severityFlag: string;
  confidenceFlag?: string | undefined;
  appliesToFlags?: unknown;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void; stderr: (line: string) => void; json?: boolean;
  newId?: () => string; now?: () => string;
};

export async function runLearnFromFailure(input: RunLearnFromFailureInput): Promise<0 | 1> {
  let rootDir: string;
  try { rootDir = resolveStorePath(input); } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" }); input.stderr(cli.message); return cli.exitCode;
  }
  let failureId: ReturnType<typeof failedAttemptIdSchema.parse>;
  try { failureId = failedAttemptIdSchema.parse(input.idFlag); } catch {
    input.stderr(`error: invalid failed attempt id "${input.idFlag}"`); return 1;
  }
  const severity = ruleSeveritySchema.safeParse(input.severityFlag);
  if (!severity.success) { input.stderr(`error: invalid severity "${input.severityFlag}"`); return 1; }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const appliesTo = toStringArray(input.appliesToFlags);
    const { rule, failure } = registry.convertFailureToRule(
      failureId,
      {
        title: input.titleFlag,
        rule: input.ruleFlag,
        severity: severity.data,
        ...(input.confidenceFlag !== undefined ? { confidence: input.confidenceFlag } : {}),
        ...(appliesTo.length > 0 ? { appliesTo } : {}),
      } as Parameters<typeof registry.convertFailureToRule>[1],
      { now, newId },
    );
    input.stdout(input.json ? JSON.stringify({ ruleId: rule.id, failureId: failure.id }) : `rule ${rule.id} (from failure ${failure.id})`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" }); input.stderr(cli.message); return cli.exitCode;
  }
}

export const learnCommand = defineCommand({
  meta: { name: "learn", description: "Learn reusable rules from failures." },
  subCommands: {
    "from-failure": defineCommand({
      meta: { name: "from-failure", description: "Convert a failed attempt into a project rule." },
      args: {
        id: { type: "positional", required: true, description: "Failed attempt id (UUID)." },
        title: { type: "string", required: true, description: "Rule title." },
        rule: { type: "string", required: true, description: "Rule body." },
        severity: { type: "string", required: true, description: "info | warning | critical." },
        confidence: { type: "string", description: "low | medium | high." },
        "applies-to": { type: "string", description: "Path/glob (repeatable); defaults to the failure's related files." },
        store: { type: "string", description: "Override store directory." },
        json: { type: "boolean", default: false, description: "Emit JSON output." },
      },
      async run({ args }) {
        const code = await runLearnFromFailure({
          idFlag: typeof args.id === "string" ? args.id : "",
          titleFlag: typeof args.title === "string" ? args.title : "",
          ruleFlag: typeof args.rule === "string" ? args.rule : "",
          severityFlag: typeof args.severity === "string" ? args.severity : "",
          confidenceFlag: typeof args.confidence === "string" ? args.confidence : undefined,
          appliesToFlags: args["applies-to"],
          ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
          stdout: (line) => console.log(line),
          stderr: (line) => console.error(line),
          json: !!args.json,
        });
        if (code !== 0) process.exitCode = code;
      },
    }),
  },
});
```

> Note: `learn.ts` sits at `apps/cli/src/commands/learn.ts` — imports are `../store.js`, `../errors.js`, and `./fail/shared.js` (as shown). The `confidence` value is passed through and re-validated by `failureToRuleInputSchema` inside the registry, which rejects a bad confidence string with a schema error mapped to exit 1.

- [ ] **Step 3b: Register in `main.ts`** — `import { learnCommand } from "./commands/learn.js";` and add `learn: learnCommand,` to `subCommands`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test learn`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/learn.ts apps/cli/src/main.ts apps/cli/test/learn.test.ts
git commit -m "feat(cli): mega learn from-failure (convert failure to rule)"
```

---

## Task 15: Full gate + changeset

**Files:**
- Create: `.changeset/phase5-forge.md`

- [ ] **Step 1: Run the CI-equivalent gate**

Run: `pnpm verify`
Expected: lint (`biome check .`) clean, typecheck clean, all tests pass, conventions ok. If lint reports format/import-sort issues, run `pnpm lint:fix`, re-inspect that only Phase 5 files changed, and re-run `pnpm verify`. If a per-package step fails only on an unresolved `@megasaver/*` import, build that dep and re-run.

- [ ] **Step 2: Confirm the 18-tool surface end-to-end**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e -t "lists 18 tools"`
Expected: PASS.

- [ ] **Step 3: Write the changeset** (`.changeset/phase5-forge.md`)

```md
---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 5 — FORGE failed-run learning. Adds failure-similarity search,
convert-failure-to-rule (caller-supplied insight; engine does linkage,
evidence seeding, and the convertedToRule flip atomically), and scored
applicable-rule retrieval. New: 2 pure ranking modules + 3 CoreRegistry
methods (updateFailedAttempt, searchFailedAttempts, convertFailureToRule),
3 MCP tools (convert_failure_to_rule, find_similar_failures,
get_applicable_rules; bridge now 18 tools), and CLI (mega fail, mega rules,
mega learn from-failure). No LLM, no embeddings — reuses rankBm25.
```

(Match the existing `.changeset/` file format if it differs from this sample.)

- [ ] **Step 4: Commit**

```bash
git add .changeset/phase5-forge.md
git commit -m "chore: changeset for Phase 5 FORGE failed-run learning"
```

- [ ] **Step 5: Push + PR (when ready)**

```bash
git push -u origin feat/phase5-forge-learning
```

Open a PR titled `feat: Phase 5 — FORGE failed-run learning (15 → 18 tools)` against `main`, linking the spec.

---

## Self-Review Notes

- **Spec coverage:** §3a→T1, §3b→T2, §4 schemas→T3, error code→T4, §4 registry→T5, barrel→T6, §5 tools→T7/T8/T9 + wiring T10 + e2e T11, §6 CLI→T12/T13/T14, §9 testing→tests in every task, changeset/gate→T15. All spec sections mapped.
- **Type consistency:** registry methods (`updateFailedAttempt`/`searchFailedAttempts`/`convertFailureToRule`) identical across interface, both impls, MCP, CLI. Pure fns (`searchFailedAttempts`/`rankApplicableRules`) and types (`FailedAttemptSearchQuery`/`ApplicableRuleQuery`/`RankedRule`/`ConvertFailureResult`/`FailureToRuleInput`/`FailedAttemptPatch`) consistent between definition and consumers. Handler names (`handleFindSimilarFailures`/`handleGetApplicableRules`/`handleConvertFailureToRule`) match tool file, server import, tests.
- **Atomicity:** json `convertFailureToRule`/`updateFailedAttempt` inline store calls under one `withDirLock` (no re-entrant public-method calls) — flagged explicitly in T5.
- **No update/delete** on rules; failures get only the closed `failedAttemptPatchSchema` — matches spec §2.
- **Known import-path fix** called out inline in T14 (`learn.ts` uses `../store.js`/`../errors.js`).
