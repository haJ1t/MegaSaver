# Phase 4 — MCP Server (full roadmap surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four remaining roadmap "first MCP tools" (`get_project_context`, `record_failed_attempt`, `save_project_rule`, `get_project_rules`) backed by two first-class core entities (`ProjectRule`, `FailedAttempt`), taking the bridge from 11 to 15 tools.

**Architecture:** Two new core entities follow the exact `memory-entry` pattern — zod `.strict()` schema, branded id from `@megasaver/shared`, per-project JSONL storage, `CoreRegistry` CRUD on both the in-memory and json-directory implementations. Four new MCP tool handlers mirror `save-memory.ts` (zod input → schema parse → registry call → JSON result). `get_project_context` is a read-only aggregator over project meta + rules + key memories + the Phase 2 index + open failures. Additive only: no existing schema, store file, or tool changes shape.

**Tech Stack:** TypeScript (strict ESM, `exactOptionalPropertyTypes`), zod, vitest, `@modelcontextprotocol/sdk`, pnpm + turbo monorepo, biome.

**Spec:** `docs/superpowers/specs/2026-06-11-phase4-mcp-server-design.md`

**Working dir:** `.worktrees/phase4-mcp` (branch `feat/phase4-mcp-server`, off `main`).

**Run tests from the worktree root.** Per-package: `pnpm --filter @megasaver/<pkg> test`. Type-check: `pnpm --filter @megasaver/<pkg> typecheck`. Full gate (final task): `pnpm -w turbo run test typecheck lint`.

---

## File Structure

**Create:**
- `packages/core/src/project-rule.ts` — `ProjectRule` schema + enums
- `packages/core/src/failed-attempt.ts` — `FailedAttempt` schema
- `packages/core/test/project-rule.test.ts` — schema tests
- `packages/core/test/failed-attempt.test.ts` — schema tests
- `packages/core/test/registry-rules-failures.test.ts` — registry CRUD (in-memory + json round-trip)
- `packages/mcp-bridge/src/tools/failed-attempts.ts` — `record_failed_attempt` handler
- `packages/mcp-bridge/src/tools/project-rules.ts` — `save_project_rule` + `get_project_rules` handlers
- `packages/mcp-bridge/src/tools/project-context.ts` — `get_project_context` aggregator
- `packages/mcp-bridge/test/tools/rules-failures-tools.test.ts` — handler tests
- `packages/mcp-bridge/test/tools/project-context-tool.test.ts` — aggregator tests

**Modify:**
- `packages/shared/src/ids.ts` — two branded ids
- `packages/core/src/errors.ts` — four registry error codes
- `packages/core/src/json-directory-store.ts` — two store dirs + read/write helpers
- `packages/core/src/registry.ts` — `CoreRegistry` interface + in-memory impl
- `packages/core/src/json-directory-registry.ts` — json-directory impl
- `packages/core/src/index.ts` — export new modules
- `packages/mcp-bridge/src/tool-name.ts` — enum 11 → 15
- `packages/mcp-bridge/src/server.ts` — `TOOL_DEFS` + dispatch
- `packages/mcp-bridge/test/server.e2e.test.ts` — 15-tool assertion + new tool calls

---

## Task 1: Shared branded ids

**Files:**
- Modify: `packages/shared/src/ids.ts` (append after `codeBlockIdSchema`)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/ids-phase4.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { failedAttemptIdSchema, projectRuleIdSchema } from "../src/ids.js";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("phase 4 branded ids", () => {
  it("projectRuleIdSchema accepts a lowercase uuid", () => {
    expect(projectRuleIdSchema.parse(UUID)).toBe(UUID);
  });
  it("failedAttemptIdSchema accepts a lowercase uuid", () => {
    expect(failedAttemptIdSchema.parse(UUID)).toBe(UUID);
  });
  it("rejects an uppercase uuid", () => {
    expect(() => projectRuleIdSchema.parse(UUID.toUpperCase())).toThrow();
    expect(() => failedAttemptIdSchema.parse(UUID.toUpperCase())).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/shared test ids-phase4`
Expected: FAIL — `projectRuleIdSchema` / `failedAttemptIdSchema` not exported.

- [ ] **Step 3: Add the ids**

Append to `packages/shared/src/ids.ts`:

```ts
export const projectRuleIdSchema = lowercaseUuid.brand<"ProjectRuleId">();
export type ProjectRuleId = z.infer<typeof projectRuleIdSchema>;

export const failedAttemptIdSchema = lowercaseUuid.brand<"FailedAttemptId">();
export type FailedAttemptId = z.infer<typeof failedAttemptIdSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/shared test ids-phase4`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ids.ts packages/shared/test/ids-phase4.test.ts
git commit -m "feat(shared): ProjectRuleId + FailedAttemptId branded ids"
```

---

## Task 2: ProjectRule schema

**Files:**
- Create: `packages/core/src/project-rule.ts`
- Test: `packages/core/test/project-rule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/project-rule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type ProjectRule,
  projectRuleSchema,
  ruleCreatedFromSchema,
  ruleSeveritySchema,
} from "../src/project-rule.js";

const RULE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

const valid = {
  id: RULE_ID,
  projectId: PROJECT_ID,
  title: "Migrate before regenerate",
  rule: "When changing Prisma schema, create a migration and regenerate the client.",
  appliesTo: ["prisma/schema.prisma", "src/db/"],
  evidence: ["Failed test on 2026-06-11: stale Prisma client."],
  severity: "warning",
  confidence: "high",
  createdFrom: "failed_attempt",
  createdAt: TS,
  updatedAt: TS,
};

describe("projectRuleSchema", () => {
  it("parses a valid rule", () => {
    const parsed: ProjectRule = projectRuleSchema.parse(valid);
    expect(parsed.severity).toBe("warning");
    expect(parsed.appliesTo).toEqual(["prisma/schema.prisma", "src/db/"]);
  });

  it("defaults appliesTo and evidence to empty arrays", () => {
    const { appliesTo, evidence, ...rest } = valid;
    const parsed = projectRuleSchema.parse(rest);
    expect(parsed.appliesTo).toEqual([]);
    expect(parsed.evidence).toEqual([]);
  });

  it("rejects an empty rule body", () => {
    expect(() => projectRuleSchema.parse({ ...valid, rule: "" })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => projectRuleSchema.parse({ ...valid, extra: 1 })).toThrow();
  });

  it("severity and createdFrom are closed enums", () => {
    expect(ruleSeveritySchema.options).toEqual(["info", "warning", "critical"]);
    expect(ruleCreatedFromSchema.options).toEqual(["manual", "failed_attempt", "test_failure"]);
    expect(() => projectRuleSchema.parse({ ...valid, severity: "fatal" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test project-rule`
Expected: FAIL — cannot find `../src/project-rule.js`.

- [ ] **Step 3: Write the schema**

Create `packages/core/src/project-rule.ts`:

```ts
import { projectIdSchema, projectRuleIdSchema, titleSchema } from "@megasaver/shared";
import { z } from "zod";
import { memoryConfidenceSchema } from "./memory-entry.js";

// Order: ascending blast radius (info < warning < critical). AA3: declaration
// order is a contract.
export const ruleSeveritySchema = z.enum(["info", "warning", "critical"]);
export type RuleSeverity = z.infer<typeof ruleSeveritySchema>;

// Order: roadmap declaration order (Phase 5 FORGE). Where a rule came from.
export const ruleCreatedFromSchema = z.enum(["manual", "failed_attempt", "test_failure"]);
export type RuleCreatedFrom = z.infer<typeof ruleCreatedFromSchema>;

// Confidence reuses the memory-entry enum (low|medium|high) — same trust ladder.
export const ruleConfidenceSchema = memoryConfidenceSchema;

export const projectRuleSchema = z
  .object({
    id: projectRuleIdSchema,
    projectId: projectIdSchema,
    title: titleSchema,
    rule: z.string().trim().min(1),
    appliesTo: z.array(z.string()).default([]),
    evidence: z.array(z.string()).default([]),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema,
    createdFrom: ruleCreatedFromSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ProjectRule = z.infer<typeof projectRuleSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test project-rule`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/project-rule.ts packages/core/test/project-rule.test.ts
git commit -m "feat(core): ProjectRule schema"
```

---

## Task 3: FailedAttempt schema

**Files:**
- Create: `packages/core/src/failed-attempt.ts`
- Test: `packages/core/test/failed-attempt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/failed-attempt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type FailedAttempt, failedAttemptSchema } from "../src/failed-attempt.js";

const FA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-11T00:00:00.000Z";

const valid = {
  id: FA_ID,
  projectId: PROJECT_ID,
  sessionId: SESSION_ID,
  task: "fix login bug",
  failedStep: "run auth tests",
  errorOutput: "Expected 200, got 401",
  relatedFiles: ["src/middleware/auth.ts"],
  suspectedCause: "expiry check uses < not <=",
  resolution: "use <=",
  convertedToRule: false,
  createdAt: TS,
};

describe("failedAttemptSchema", () => {
  it("parses a valid failed attempt", () => {
    const parsed: FailedAttempt = failedAttemptSchema.parse(valid);
    expect(parsed.failedStep).toBe("run auth tests");
    expect(parsed.convertedToRule).toBe(false);
  });

  it("allows a null sessionId", () => {
    expect(failedAttemptSchema.parse({ ...valid, sessionId: null }).sessionId).toBeNull();
  });

  it("defaults relatedFiles to [] and convertedToRule to false", () => {
    const { relatedFiles, convertedToRule, ...rest } = valid;
    const parsed = failedAttemptSchema.parse(rest);
    expect(parsed.relatedFiles).toEqual([]);
    expect(parsed.convertedToRule).toBe(false);
  });

  it("rejects an empty failedStep", () => {
    expect(() => failedAttemptSchema.parse({ ...valid, failedStep: "" })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => failedAttemptSchema.parse({ ...valid, extra: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test failed-attempt`
Expected: FAIL — cannot find `../src/failed-attempt.js`.

- [ ] **Step 3: Write the schema**

Create `packages/core/src/failed-attempt.ts`:

```ts
import { failedAttemptIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const failedAttemptSchema = z
  .object({
    id: failedAttemptIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    task: z.string().trim().min(1),
    failedStep: z.string().trim().min(1),
    errorOutput: z.string().trim().min(1).optional(),
    relatedFiles: z.array(z.string()).default([]),
    suspectedCause: z.string().trim().min(1).optional(),
    resolution: z.string().trim().min(1).optional(),
    convertedToRule: z.boolean().default(false),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type FailedAttempt = z.infer<typeof failedAttemptSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test failed-attempt`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/failed-attempt.ts packages/core/test/failed-attempt.test.ts
git commit -m "feat(core): FailedAttempt schema"
```

---

## Task 4: Core registry error codes

**Files:**
- Modify: `packages/core/src/errors.ts:3-11` (the `coreRegistryErrorCodeSchema` enum)

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/errors-phase4.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 4 registry error codes", () => {
  it("includes the rule + failed-attempt codes", () => {
    for (const code of [
      "project_rule_already_exists",
      "project_rule_not_found",
      "failed_attempt_already_exists",
      "failed_attempt_not_found",
    ]) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test errors-phase4`
Expected: FAIL — codes not in the enum.

- [ ] **Step 3: Extend the enum**

In `packages/core/src/errors.ts`, replace the `coreRegistryErrorCodeSchema` enum body so it ends with the four new codes:

```ts
export const coreRegistryErrorCodeSchema = z.enum([
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_already_ended",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
  "memory_entry_not_found",
  "project_rule_already_exists",
  "project_rule_not_found",
  "failed_attempt_already_exists",
  "failed_attempt_not_found",
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test errors-phase4`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/test/errors-phase4.test.ts
git commit -m "feat(core): registry error codes for rules + failed attempts"
```

---

## Task 5: Store helpers for the two new entities

**Files:**
- Modify: `packages/core/src/json-directory-store.ts`

Adds two store dirs and read/write helpers mirroring the memory helpers. The full gate runs in Task 13; here we verify via a focused store test.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/store-rules-failures.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readFailedAttemptsForProject,
  readProjectRulesForProject,
  resolveStorePaths,
  writeFailedAttemptsForProject,
  writeProjectRulesForProject,
} from "../src/json-directory-store.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-11T00:00:00.000Z";

const rule = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  projectId: PROJECT_ID,
  title: "r",
  rule: "do x",
  appliesTo: [],
  evidence: [],
  severity: "info",
  confidence: "low",
  createdFrom: "manual",
  createdAt: TS,
  updatedAt: TS,
} as const;

const failure = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  projectId: PROJECT_ID,
  sessionId: null,
  task: "t",
  failedStep: "s",
  relatedFiles: [],
  convertedToRule: false,
  createdAt: TS,
} as const;

describe("rule + failed-attempt store helpers", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "store-p4-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("round-trips project rules per project", () => {
    const paths = resolveStorePaths(root);
    expect(readProjectRulesForProject(paths, PROJECT_ID)).toEqual([]);
    writeProjectRulesForProject(paths, PROJECT_ID, [rule]);
    expect(readProjectRulesForProject(paths, PROJECT_ID)).toEqual([rule]);
  });

  it("round-trips failed attempts per project", () => {
    const paths = resolveStorePaths(root);
    expect(readFailedAttemptsForProject(paths, PROJECT_ID)).toEqual([]);
    writeFailedAttemptsForProject(paths, PROJECT_ID, [failure]);
    expect(readFailedAttemptsForProject(paths, PROJECT_ID)).toEqual([failure]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test store-rules-failures`
Expected: FAIL — helpers not exported.

- [ ] **Step 3a: Import the new schemas**

In `packages/core/src/json-directory-store.ts`, after the `memory-entry.js` import add:

```ts
import { type FailedAttempt, failedAttemptSchema } from "./failed-attempt.js";
import { type ProjectRule, projectRuleSchema } from "./project-rule.js";
```

- [ ] **Step 3b: Extend StorePaths and resolveStorePaths**

Add two fields to the `StorePaths` type:

```ts
export type StorePaths = {
  rootDir: string;
  projectsPath: string;
  sessionsPath: string;
  memoryDir: string;
  projectRulesDir: string;
  failedAttemptsDir: string;
};
```

`resolveStorePaths` returns the paths object in **two** places (the ENOENT branch and the normal return). Add these two lines to **both** returned objects:

```ts
    projectRulesDir: join(resolvedRootDir, "project-rules"),
    failedAttemptsDir: join(resolvedRootDir, "failed-attempts"),
```

- [ ] **Step 3c: Add the read/write helpers**

Append to `packages/core/src/json-directory-store.ts` (after `writeMemoryEntriesForProject`):

```ts
export function readProjectRulesForProject(
  paths: StorePaths,
  projectId: ProjectId,
): ProjectRule[] {
  const filePath = join(paths.projectRulesDir, `${projectId}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(projectRuleSchema, entry, filePath));
}

export function writeProjectRulesForProject(
  paths: StorePaths,
  projectId: ProjectId,
  rules: readonly ProjectRule[],
): void {
  const filePath = join(paths.projectRulesDir, `${projectId}.jsonl`);
  if (rules.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${rules.map((rule) => JSON.stringify(rule)).join("\n")}\n`);
}

export function readFailedAttemptsForProject(
  paths: StorePaths,
  projectId: ProjectId,
): FailedAttempt[] {
  const filePath = join(paths.failedAttemptsDir, `${projectId}.jsonl`);
  return readJsonLines(filePath).map((entry) =>
    parseEntity(failedAttemptSchema, entry, filePath),
  );
}

export function writeFailedAttemptsForProject(
  paths: StorePaths,
  projectId: ProjectId,
  attempts: readonly FailedAttempt[],
): void {
  const filePath = join(paths.failedAttemptsDir, `${projectId}.jsonl`);
  if (attempts.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${attempts.map((fa) => JSON.stringify(fa)).join("\n")}\n`);
}

// Mirrors the empty-set branch of writeMemoryEntriesForProject: an empty entity
// set must delete the file (readJsonLines treats a zero-byte file as corrupt).
function removeIfExists(filePath: string): void {
  try {
    rmSync(filePath);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw new CorePersistenceError("store_write_failed", "Store write failed.", {
        filePath,
        cause: error,
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test store-rules-failures`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/json-directory-store.ts packages/core/test/store-rules-failures.test.ts
git commit -m "feat(core): JSONL store helpers for project rules + failed attempts"
```

---

## Task 6: Registry CRUD (interface + in-memory + json-directory)

**Files:**
- Modify: `packages/core/src/registry.ts` (interface + in-memory impl)
- Modify: `packages/core/src/json-directory-registry.ts` (json impl)
- Test: `packages/core/test/registry-rules-failures.test.ts`

> One task: adding interface methods forces **both** implementations to satisfy the interface, so they must land together to keep the build green.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/registry-rules-failures.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  failedAttemptIdSchema,
  projectIdSchema,
  projectRuleIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const RULE_ID = projectRuleIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const FA_ID = failedAttemptIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const TS = "2026-06-11T00:00:00.000Z";

const project = {
  id: PROJECT_ID,
  name: "demo",
  rootPath: "/tmp/demo",
  createdAt: TS,
  updatedAt: TS,
} as const;

const rule = {
  id: RULE_ID,
  projectId: PROJECT_ID,
  title: "r",
  rule: "do x",
  appliesTo: ["src/db/"],
  evidence: [],
  severity: "warning",
  confidence: "high",
  createdFrom: "manual",
  createdAt: TS,
  updatedAt: TS,
} as const;

const failure = {
  id: FA_ID,
  projectId: PROJECT_ID,
  sessionId: null,
  task: "t",
  failedStep: "s",
  relatedFiles: [],
  convertedToRule: false,
  createdAt: TS,
} as const;

function suite(name: string, make: () => CoreRegistry) {
  describe(`${name}: rules + failed attempts`, () => {
    it("creates, gets, and lists a project rule", () => {
      const r = make();
      r.createProject(project);
      expect(r.createProjectRule(rule)).toEqual(rule);
      expect(r.getProjectRule(RULE_ID)).toEqual(rule);
      expect(r.listProjectRules(PROJECT_ID)).toEqual([rule]);
    });

    it("rejects a duplicate rule id", () => {
      const r = make();
      r.createProject(project);
      r.createProjectRule(rule);
      expect(() => r.createProjectRule(rule)).toThrow(CoreRegistryError);
    });

    it("rejects a rule for an unknown project", () => {
      const r = make();
      expect(() => r.createProjectRule(rule)).toThrowError(/project_not_found|does not exist/);
    });

    it("returns null for a missing rule", () => {
      const r = make();
      r.createProject(project);
      expect(r.getProjectRule(RULE_ID)).toBeNull();
    });

    it("creates, gets, and lists a failed attempt", () => {
      const r = make();
      r.createProject(project);
      expect(r.createFailedAttempt(failure)).toEqual(failure);
      expect(r.getFailedAttempt(FA_ID)).toEqual(failure);
      expect(r.listFailedAttempts(PROJECT_ID)).toEqual([failure]);
    });

    it("validates the session on a session-scoped failed attempt", () => {
      const r = make();
      r.createProject(project);
      expect(() => r.createFailedAttempt({ ...failure, sessionId: SESSION_ID })).toThrowError(
        /session_not_found|does not exist/,
      );
    });
  });
}

suite("in-memory", () => createInMemoryCoreRegistry());

describe("json-directory", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reg-p4-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  suite("json", () => createJsonDirectoryCoreRegistry({ rootDir: root }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test registry-rules-failures`
Expected: FAIL — `createProjectRule` etc. not on `CoreRegistry`.

- [ ] **Step 3a: Extend the CoreRegistry interface**

In `packages/core/src/registry.ts`, add imports at the top:

```ts
import { type FailedAttempt, failedAttemptSchema } from "./failed-attempt.js";
import { type ProjectRule, projectRuleSchema } from "./project-rule.js";
```

and import the id types from shared (extend the existing `@megasaver/shared` type import):

```ts
import type {
  FailedAttemptId,
  MemoryEntryId,
  ProjectId,
  ProjectRuleId,
  SessionId,
} from "@megasaver/shared";
```

Add to the `CoreRegistry` interface (after `searchMemoryEntries`):

```ts
  createProjectRule(rule: ProjectRule): ProjectRule;
  getProjectRule(id: ProjectRuleId): ProjectRule | null;
  listProjectRules(projectId: ProjectId): ProjectRule[];
  createFailedAttempt(attempt: FailedAttempt): FailedAttempt;
  getFailedAttempt(id: FailedAttemptId): FailedAttempt | null;
  listFailedAttempts(projectId: ProjectId): FailedAttempt[];
```

- [ ] **Step 3b: Implement in `createInMemoryCoreRegistry`**

In `packages/core/src/registry.ts`, add two maps next to the existing ones:

```ts
  const projectRules = new Map<ProjectRuleId, ProjectRule>();
  const failedAttempts = new Map<FailedAttemptId, FailedAttempt>();
```

Add these methods to the returned object (after `searchMemoryEntries`):

```ts
    createProjectRule(rule) {
      const parsed = projectRuleSchema.parse(rule);
      if (projectRules.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_rule_already_exists",
          `Project rule already exists: ${parsed.id}`,
        );
      }
      requireProject(parsed.projectId);
      projectRules.set(parsed.id, parsed);
      return projectRuleSchema.parse(parsed);
    },

    getProjectRule(id) {
      const rule = projectRules.get(id);
      return rule ? projectRuleSchema.parse(rule) : null;
    },

    listProjectRules(projectId) {
      requireProject(projectId);
      return Array.from(projectRules.values())
        .filter((rule) => rule.projectId === projectId)
        .map((rule) => projectRuleSchema.parse(rule));
    },

    createFailedAttempt(attempt) {
      const parsed = failedAttemptSchema.parse(attempt);
      if (failedAttempts.has(parsed.id)) {
        throw new CoreRegistryError(
          "failed_attempt_already_exists",
          `Failed attempt already exists: ${parsed.id}`,
        );
      }
      requireProject(parsed.projectId);
      if (parsed.sessionId !== null) {
        const session = sessions.get(parsed.sessionId);
        if (!session) {
          throw new CoreRegistryError(
            "session_not_found",
            `Session does not exist: ${parsed.sessionId}`,
          );
        }
        if (session.projectId !== parsed.projectId) {
          throw new CoreRegistryError(
            "session_project_mismatch",
            `Session ${parsed.sessionId} does not belong to project ${parsed.projectId}`,
          );
        }
      }
      failedAttempts.set(parsed.id, parsed);
      return failedAttemptSchema.parse(parsed);
    },

    getFailedAttempt(id) {
      const attempt = failedAttempts.get(id);
      return attempt ? failedAttemptSchema.parse(attempt) : null;
    },

    listFailedAttempts(projectId) {
      requireProject(projectId);
      return Array.from(failedAttempts.values())
        .filter((attempt) => attempt.projectId === projectId)
        .map((attempt) => failedAttemptSchema.parse(attempt));
    },
```

- [ ] **Step 3c: Implement in `createJsonDirectoryCoreRegistry`**

In `packages/core/src/json-directory-registry.ts`, add imports:

```ts
import { type FailedAttempt, failedAttemptSchema } from "./failed-attempt.js";
import { type ProjectRule, projectRuleSchema } from "./project-rule.js";
```

Extend the store-helper import block (the one importing `readMemoryEntriesForProject` etc.) with:

```ts
  readFailedAttemptsForProject,
  readProjectRulesForProject,
  writeFailedAttemptsForProject,
  writeProjectRulesForProject,
```

Add these methods to the returned object (after `searchMemoryEntries`):

```ts
    createProjectRule(rule) {
      return withDirLock(options.rootDir, () => {
        const parsed = projectRuleSchema.parse(rule);
        requireProject(parsed.projectId);
        const existing = readProjectRulesForProject(paths, parsed.projectId);
        if (existing.some((r) => r.id === parsed.id)) {
          throw new CoreRegistryError(
            "project_rule_already_exists",
            `Project rule already exists: ${parsed.id}`,
          );
        }
        writeProjectRulesForProject(paths, parsed.projectId, [...existing, parsed]);
        return projectRuleSchema.parse(parsed);
      });
    },

    getProjectRule(id) {
      for (const project of readProjects(paths)) {
        const rule = readProjectRulesForProject(paths, project.id).find((r) => r.id === id);
        if (rule) return projectRuleSchema.parse(rule);
      }
      return null;
    },

    listProjectRules(projectId) {
      requireProject(projectId);
      return readProjectRulesForProject(paths, projectId).map((r) => projectRuleSchema.parse(r));
    },

    createFailedAttempt(attempt) {
      return withDirLock(options.rootDir, () => {
        const parsed = failedAttemptSchema.parse(attempt);
        requireProject(parsed.projectId);
        if (parsed.sessionId !== null) {
          const session = readSessions(paths).find((s) => s.id === parsed.sessionId);
          if (!session) {
            throw new CoreRegistryError(
              "session_not_found",
              `Session does not exist: ${parsed.sessionId}`,
            );
          }
          if (session.projectId !== parsed.projectId) {
            throw new CoreRegistryError(
              "session_project_mismatch",
              `Session ${parsed.sessionId} does not belong to project ${parsed.projectId}`,
            );
          }
        }
        const existing = readFailedAttemptsForProject(paths, parsed.projectId);
        if (existing.some((fa) => fa.id === parsed.id)) {
          throw new CoreRegistryError(
            "failed_attempt_already_exists",
            `Failed attempt already exists: ${parsed.id}`,
          );
        }
        writeFailedAttemptsForProject(paths, parsed.projectId, [...existing, parsed]);
        return failedAttemptSchema.parse(parsed);
      });
    },

    getFailedAttempt(id) {
      for (const project of readProjects(paths)) {
        const fa = readFailedAttemptsForProject(paths, project.id).find((f) => f.id === id);
        if (fa) return failedAttemptSchema.parse(fa);
      }
      return null;
    },

    listFailedAttempts(projectId) {
      requireProject(projectId);
      return readFailedAttemptsForProject(paths, projectId).map((fa) =>
        failedAttemptSchema.parse(fa),
      );
    },
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm --filter @megasaver/core test registry-rules-failures && pnpm --filter @megasaver/core typecheck`
Expected: PASS (12 tests: 6 × in-memory + 6 × json), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry.ts packages/core/src/json-directory-registry.ts packages/core/test/registry-rules-failures.test.ts
git commit -m "feat(core): registry CRUD for project rules + failed attempts"
```

---

## Task 7: Export the new core modules

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/index-phase4.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("core barrel exports (phase 4)", () => {
  it("re-exports the new schemas", () => {
    expect(core.projectRuleSchema).toBeDefined();
    expect(core.failedAttemptSchema).toBeDefined();
    expect(core.ruleSeveritySchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test index-phase4`
Expected: FAIL — exports undefined.

- [ ] **Step 3: Add the exports**

In `packages/core/src/index.ts`, add (keep alphabetic grouping near `memory-entry`):

```ts
export * from "./failed-attempt.js";
export * from "./project-rule.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test index-phase4`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index-phase4.test.ts
git commit -m "feat(core): export ProjectRule + FailedAttempt from barrel"
```

---

## Task 8: MCP tool — record_failed_attempt

**Files:**
- Create: `packages/mcp-bridge/src/tools/failed-attempts.ts`
- Test: `packages/mcp-bridge/test/tools/rules-failures-tools.test.ts` (created here, extended in Task 9)

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-bridge/test/tools/rules-failures-tools.test.ts`:

```ts
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleRecordFailedAttempt } from "../../src/tools/failed-attempts.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

const newId = () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("record_failed_attempt", () => {
  it("records a failed attempt and returns its id", async () => {
    const registry = seededRegistry();
    const res = await handleRecordFailedAttempt(
      { registry, now: () => TS, newId },
      {
        projectId: PROJECT_ID,
        task: "fix login bug",
        failedStep: "run auth tests",
        errorOutput: "401",
        relatedFiles: ["src/middleware/auth.ts"],
      },
    );
    expect(res.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const stored = registry.getFailedAttempt(res.id as never);
    expect(stored?.failedStep).toBe("run auth tests");
    expect(stored?.convertedToRule).toBe(false);
  });

  it("rejects an unknown project as resource_not_found", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecordFailedAttempt(
        { registry, now: () => TS, newId },
        { projectId: "99999999-9999-4999-8999-999999999999", task: "t", failedStep: "s" },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("rejects invalid input as validation_failed", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecordFailedAttempt(
        { registry, now: () => TS, newId },
        { projectId: PROJECT_ID, task: "t" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test rules-failures-tools`
Expected: FAIL — handler module missing.

- [ ] **Step 3: Write the handler**

Create `packages/mcp-bridge/src/tools/failed-attempts.ts`:

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type FailedAttempt,
  failedAttemptSchema,
} from "@megasaver/core";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RecordFailedAttemptEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    failedStep: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    errorOutput: z.string().min(1).optional(),
    relatedFiles: z.array(z.string()).optional(),
    suspectedCause: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
  })
  .strict();

// CoreRegistry failures carry a closed code; surface it as the matching wire code.
function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "session_not_found") return new McpBridgeError("session_not_found", err.message);
    if (err.code === "project_not_found") return new McpBridgeError("resource_not_found", err.message);
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "record_failed_attempt failed");
}

export async function handleRecordFailedAttempt(
  env: RecordFailedAttemptEnv,
  rawArgs: unknown,
): Promise<{ id: string }> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;

  let attempt: FailedAttempt;
  try {
    attempt = failedAttemptSchema.parse({
      id: env.newId(),
      projectId: d.projectId,
      sessionId: d.sessionId ?? null,
      task: d.task,
      failedStep: d.failedStep,
      relatedFiles: d.relatedFiles ?? [],
      convertedToRule: false,
      createdAt: env.now(),
      ...(d.errorOutput !== undefined ? { errorOutput: d.errorOutput } : {}),
      ...(d.suspectedCause !== undefined ? { suspectedCause: d.suspectedCause } : {}),
      ...(d.resolution !== undefined ? { resolution: d.resolution } : {}),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid failed attempt",
    );
  }

  try {
    const created = env.registry.createFailedAttempt(attempt);
    return { id: created.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test rules-failures-tools`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/failed-attempts.ts packages/mcp-bridge/test/tools/rules-failures-tools.test.ts
git commit -m "feat(mcp-bridge): record_failed_attempt tool"
```

---

## Task 9: MCP tools — save_project_rule + get_project_rules

**Files:**
- Create: `packages/mcp-bridge/src/tools/project-rules.ts`
- Modify: `packages/mcp-bridge/test/tools/rules-failures-tools.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the Task 8 test file)**

Add the import at the top of `rules-failures-tools.test.ts`:

```ts
import { handleGetProjectRules, handleSaveProjectRule } from "../../src/tools/project-rules.js";
```

Append these blocks at the end of the file:

```ts
describe("save_project_rule + get_project_rules", () => {
  it("saves a rule and returns its id", async () => {
    const registry = seededRegistry();
    const res = await handleSaveProjectRule(
      { registry, now: () => TS, newId },
      {
        projectId: PROJECT_ID,
        title: "Migrate first",
        rule: "Create a migration before regenerating the client.",
        severity: "warning",
        appliesTo: ["prisma/schema.prisma"],
      },
    );
    expect(res.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(registry.getProjectRule(res.id as never)?.severity).toBe("warning");
  });

  it("lists all rules when no filter is given", async () => {
    const registry = seededRegistry();
    await handleSaveProjectRule(
      { registry, now: () => TS, newId },
      { projectId: PROJECT_ID, title: "t", rule: "r", severity: "info", appliesTo: ["src/db/"] },
    );
    const res = await handleGetProjectRules({ registry }, { projectId: PROJECT_ID });
    expect(res.rules).toHaveLength(1);
  });

  it("filters rules by files via appliesTo prefix", async () => {
    const registry = seededRegistry();
    const ids = ["d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002"];
    let i = 0;
    const seqId = () => ids[i++] ?? "d0000000-0000-4000-8000-000000000009";
    await handleSaveProjectRule(
      { registry, now: () => TS, newId: seqId },
      { projectId: PROJECT_ID, title: "db", rule: "r", severity: "info", appliesTo: ["src/db/"] },
    );
    await handleSaveProjectRule(
      { registry, now: () => TS, newId: seqId },
      { projectId: PROJECT_ID, title: "ui", rule: "r", severity: "info", appliesTo: ["src/ui/"] },
    );
    const res = await handleGetProjectRules(
      { registry },
      { projectId: PROJECT_ID, files: ["src/db/schema.ts"] },
    );
    expect(res.rules.map((r) => r.title)).toEqual(["db"]);
  });

  it("rejects an unknown project as resource_not_found", async () => {
    const registry = seededRegistry();
    await expect(
      handleGetProjectRules(
        { registry },
        { projectId: "99999999-9999-4999-8999-999999999999" },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test rules-failures-tools`
Expected: FAIL — `project-rules.js` missing.

- [ ] **Step 3: Write the handlers**

Create `packages/mcp-bridge/src/tools/project-rules.ts`:

```ts
import {
  type CoreRegistry,
  CoreRegistryError,
  type ProjectRule,
  projectRuleSchema,
  ruleConfidenceSchema,
  ruleCreatedFromSchema,
  ruleSeveritySchema,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type SaveProjectRuleEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};
export type GetProjectRulesEnv = { registry: CoreRegistry };

const saveInputSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    rule: z.string().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    createdFrom: ruleCreatedFromSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
  })
  .strict();

const getInputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1).optional(),
    files: z.array(z.string()).optional(),
  })
  .strict();

export type GetProjectRulesResult = { rules: readonly ProjectRule[] };

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "project_not_found") return new McpBridgeError("resource_not_found", err.message);
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "save_project_rule failed");
}

export async function handleSaveProjectRule(
  env: SaveProjectRuleEnv,
  rawArgs: unknown,
): Promise<{ id: string }> {
  const parsed = saveInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;

  let rule: ProjectRule;
  try {
    rule = projectRuleSchema.parse({
      id: env.newId(),
      projectId: d.projectId,
      title: d.title,
      rule: d.rule,
      appliesTo: d.appliesTo ?? [],
      evidence: d.evidence ?? [],
      severity: d.severity,
      confidence: d.confidence ?? "medium",
      createdFrom: d.createdFrom ?? "manual",
      createdAt: env.now(),
      updatedAt: env.now(),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid project rule",
    );
  }

  try {
    const created = env.registry.createProjectRule(rule);
    return { id: created.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}

// Simple, deterministic filter (spec §11): a rule matches when any `appliesTo`
// entry is a prefix of a requested file (or vice-versa), or when a task term
// appears in its title/rule text. No filter → all rules. A scored rank lands
// with Phase 5 `rules apply --task`.
function ruleMatches(rule: ProjectRule, task: string | undefined, files: readonly string[]): boolean {
  if (task === undefined && files.length === 0) return true;
  for (const file of files) {
    for (const glob of rule.appliesTo) {
      if (file.startsWith(glob) || glob.startsWith(file)) return true;
    }
  }
  if (task !== undefined) {
    const haystack = `${rule.title} ${rule.rule}`.toLowerCase();
    if (task.toLowerCase().split(/\s+/).some((term) => term.length > 2 && haystack.includes(term))) {
      return true;
    }
  }
  return false;
}

export async function handleGetProjectRules(
  env: GetProjectRulesEnv,
  rawArgs: unknown,
): Promise<GetProjectRulesResult> {
  const parsed = getInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, files } = parsed.data;

  try {
    const all = env.registry.listProjectRules(projectId as ProjectId);
    const rules = all.filter((rule) => ruleMatches(rule, task, files ?? []));
    return { rules };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
```

> Note: this imports `ruleConfidenceSchema`, `ruleCreatedFromSchema`, `ruleSeveritySchema` from `@megasaver/core` — all exported via Task 7's barrel (`project-rule.js`). If typecheck reports them missing, confirm Task 7 added `export * from "./project-rule.js"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test rules-failures-tools`
Expected: PASS (3 prior + 4 new = 7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/project-rules.ts packages/mcp-bridge/test/tools/rules-failures-tools.test.ts
git commit -m "feat(mcp-bridge): save_project_rule + get_project_rules tools"
```

---

## Task 10: MCP tool — get_project_context

**Files:**
- Create: `packages/mcp-bridge/src/tools/project-context.ts`
- Test: `packages/mcp-bridge/test/tools/project-context-tool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-bridge/test/tools/project-context-tool.test.ts`:

```ts
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleGetProjectContext } from "../../src/tools/project-context.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

function seeded(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createMemoryEntry({
    id: "a0000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "architecture",
    title: "Auth uses JWT",
    content: "JWT middleware on protected routes.",
    keywords: ["auth"],
    confidence: "high",
    source: "manual",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createProjectRule({
    id: "b0000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    title: "Migrate first",
    rule: "Create a migration before regenerating the client.",
    appliesTo: ["prisma/schema.prisma"],
    evidence: [],
    severity: "critical",
    confidence: "high",
    createdFrom: "manual",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createFailedAttempt({
    id: "c0000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    sessionId: null,
    task: "schema change",
    failedStep: "regen client",
    relatedFiles: ["prisma/schema.prisma"],
    convertedToRule: false,
    createdAt: TS,
  });
  return registry;
}

describe("get_project_context", () => {
  it("aggregates meta, rules, key memories, and open failures (no index)", async () => {
    const res = await handleGetProjectContext(
      { registry: seeded(), storeRoot: "/tmp/does-not-exist-store" },
      { projectId: PROJECT_ID },
    );
    expect(res.project.name).toBe("demo");
    expect(res.rules).toHaveLength(1);
    expect(res.rules[0]?.severity).toBe("critical");
    expect(res.keyMemories.map((m) => m.title)).toContain("Auth uses JWT");
    expect(res.openFailures).toHaveLength(1);
    // No index on disk → empty summary, no throw.
    expect(res.indexSummary).toEqual({ totalBlocks: 0, fileCount: 0, byType: {} });
  });

  it("rejects an unknown project as resource_not_found", async () => {
    await expect(
      handleGetProjectContext(
        { registry: createInMemoryCoreRegistry(), storeRoot: "/tmp/x" },
        { projectId: PROJECT_ID },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test project-context-tool`
Expected: FAIL — `project-context.js` missing.

- [ ] **Step 3: Write the aggregator**

Create `packages/mcp-bridge/src/tools/project-context.ts`:

```ts
import type {
  CoreRegistry,
  FailedAttempt,
  MemoryEntry,
  Project,
  ProjectRule,
  RuleSeverity,
} from "@megasaver/core";
import { readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetProjectContextEnv = { registry: CoreRegistry; storeRoot: string };

const inputSchema = z.object({ projectId: z.string().min(1) }).strict();

export type IndexSummary = {
  totalBlocks: number;
  fileCount: number;
  byType: Record<string, number>;
};

export type ProjectContext = {
  project: Project;
  rules: readonly ProjectRule[];
  keyMemories: readonly MemoryEntry[];
  indexSummary: IndexSummary;
  openFailures: readonly FailedAttempt[];
};

// critical first — most urgent rules surface at the top of an agent briefing.
const SEVERITY_RANK: Record<RuleSeverity, number> = { critical: 0, warning: 1, info: 2 };

// "key memories" = non-stale, medium/high-confidence design knowledge an agent
// should hold for any task in this project.
const KEY_MEMORY_TYPES = new Set(["decision", "architecture", "project_rule"]);

export async function handleGetProjectContext(
  env: GetProjectContextEnv,
  rawArgs: unknown,
): Promise<ProjectContext> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = projectIdSchema.safeParse(parsed.data.projectId);
  if (!projectId.success) {
    throw new McpBridgeError("validation_failed", `invalid projectId: ${parsed.data.projectId}`);
  }

  const project = env.registry.getProject(projectId.data);
  if (project === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${parsed.data.projectId}`);
  }

  const rules = [...env.registry.listProjectRules(projectId.data)].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  const keyMemories = env.registry
    .listMemoryEntries(projectId.data)
    .filter((m) => !m.stale && m.confidence !== "low" && KEY_MEMORY_TYPES.has(m.type));

  const openFailures = env.registry
    .listFailedAttempts(projectId.data)
    .filter((fa) => !fa.convertedToRule);

  // readBlocks returns [] when no index exists on disk — graceful degradation.
  const blocks = readBlocks(resolveIndexPaths(env.storeRoot, projectId.data));
  const byType: Record<string, number> = {};
  const files = new Set<string>();
  for (const block of blocks) {
    byType[block.blockType] = (byType[block.blockType] ?? 0) + 1;
    files.add(block.filePath);
  }
  const indexSummary: IndexSummary = {
    totalBlocks: blocks.length,
    fileCount: files.size,
    byType,
  };

  return { project, rules, keyMemories, indexSummary, openFailures };
}
```

> Note: `Project`, `MemoryEntry`, `RuleSeverity` are core barrel types. If `Project` is not exported from `@megasaver/core`, import it from the same module the registry uses (`project.js` is re-exported by the core barrel — `core/src/index.ts` already has `export * from "./project.js"`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test project-context-tool`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/project-context.ts packages/mcp-bridge/test/tools/project-context-tool.test.ts
git commit -m "feat(mcp-bridge): get_project_context aggregator tool"
```

---

## Task 11: Wire the four tools into the enum + server

**Files:**
- Modify: `packages/mcp-bridge/src/tool-name.ts`
- Modify: `packages/mcp-bridge/src/server.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcp-bridge/test/tool-name-phase4.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mcpToolNameSchema } from "../src/tool-name.js";

describe("tool-name enum (phase 4)", () => {
  it("is a closed set of 15 alphabetically-ordered names", () => {
    expect(mcpToolNameSchema.options).toEqual([
      "explain_context_selection",
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

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name-phase4`
Expected: FAIL — enum has 11 names.

- [ ] **Step 3a: Extend the enum**

Replace the `mcpToolNameSchema` enum body in `packages/mcp-bridge/src/tool-name.ts` with the 15-name list above (same order). Update the leading comment to mention the Phase 4 project tools:

```ts
// Order: alphabetic (AA1 §8a, §17). Closed set of MCP tools the Mega Saver
// bridge exposes over the wire: the four AA1 context-gate tools, the Phase 1
// (DIMMEM) memory tools, the Phase 3 (LAMR) context tools, and the Phase 4
// project tools (get_project_context, get_project_rules, record_failed_attempt,
// save_project_rule).
export const mcpToolNameSchema = z.enum([
  "explain_context_selection",
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
```

- [ ] **Step 3b: Import the handlers in server.ts**

In `packages/mcp-bridge/src/server.ts`, add to the tool imports:

```ts
import { handleRecordFailedAttempt } from "./tools/failed-attempts.js";
import { handleGetProjectContext } from "./tools/project-context.js";
import { handleGetProjectRules, handleSaveProjectRule } from "./tools/project-rules.js";
```

- [ ] **Step 3c: Add TOOL_DEFS rows**

Add these four entries to `TOOL_DEFS` (keep the array alphabetic — insert `get_project_context`/`get_project_rules` after `get_context_budget_report`, `record_failed_attempt` after `mega_run_command`, `save_project_rule` after `save_memory`):

```ts
  {
    name: "get_project_context",
    description: "Project briefing: meta, rules, key memories, index summary, open failures.",
  },
  {
    name: "get_project_rules",
    description: "Reusable project rules, optionally filtered by task or files.",
  },
  { name: "record_failed_attempt", description: "Record a failed task attempt for a project." },
  { name: "save_project_rule", description: "Write a reusable project rule." },
```

- [ ] **Step 3d: Add dispatch cases**

Add to the `switch (toolName)` in `dispatch(...)`:

```ts
      case "get_project_context":
        return handleGetProjectContext(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "get_project_rules":
        return handleGetProjectRules({ registry: deps.registry }, args);
      case "record_failed_attempt":
        return handleRecordFailedAttempt({ registry: deps.registry, now, newId }, args);
      case "save_project_rule":
        return handleSaveProjectRule({ registry: deps.registry, now, newId }, args);
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm --filter @megasaver/mcp-bridge test tool-name-phase4 && pnpm --filter @megasaver/mcp-bridge typecheck`
Expected: PASS; typecheck clean (the `dispatch` switch is now exhaustive over 15 names).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/src/server.ts packages/mcp-bridge/test/tool-name-phase4.test.ts
git commit -m "feat(mcp-bridge): wire 4 Phase 4 project tools (11 -> 15)"
```

---

## Task 12: Server e2e — 15 tools, new tools callable round-trip

**Files:**
- Modify: `packages/mcp-bridge/test/server.e2e.test.ts`

- [ ] **Step 1: Write the failing test (append a describe block)**

Append to `packages/mcp-bridge/test/server.e2e.test.ts`:

```ts
describe("phase 4 tools over the bridge", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-p4-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-p4-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("lists 15 tools", async () => {
    const { client, server } = await connect(projectRoot, store);
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(15);
    expect(tools.map((t) => t.name)).toContain("get_project_context");
    await server.close();
  });

  it("save_project_rule then get_project_rules round-trips", async () => {
    const { client, server } = await connect(projectRoot, store);
    await client.callTool({
      name: "save_project_rule",
      arguments: {
        projectId: PROJECT_ID,
        title: "Migrate first",
        rule: "Create a migration before regenerating.",
        severity: "warning",
        appliesTo: ["prisma/schema.prisma"],
      },
    });
    const res = (await client.callTool({
      name: "get_project_rules",
      arguments: { projectId: PROJECT_ID },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as { rules: { title: string }[] };
    expect(payload.rules.map((r) => r.title)).toEqual(["Migrate first"]);
    await server.close();
  });

  it("record_failed_attempt surfaces in get_project_context openFailures", async () => {
    const { client, server } = await connect(projectRoot, store);
    await client.callTool({
      name: "record_failed_attempt",
      arguments: { projectId: PROJECT_ID, task: "schema change", failedStep: "regen client" },
    });
    const res = (await client.callTool({
      name: "get_project_context",
      arguments: { projectId: PROJECT_ID },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
      openFailures: unknown[];
      indexSummary: { totalBlocks: number };
    };
    expect(payload.openFailures).toHaveLength(1);
    expect(payload.indexSummary.totalBlocks).toBe(0);
    await server.close();
  });
});
```

> The `connect`/`seededRegistry`/`PROJECT_ID`/`newId` helpers already exist at the top of this file. Note the existing `connect` uses `newId: () => "cs-e2e"`, which is not a valid uuid — so this block does NOT assert returned ids; it asserts observable state (rules listed, failures surfaced). Do not change the shared `newId` (other e2e cases depend on it).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: FAIL — `record_failed_attempt`/`save_project_rule` would error on the non-uuid id from `newId: () => "cs-e2e"`.

> **If the create tools reject `"cs-e2e"`** (failedAttemptId/projectRuleId require a uuid), give this describe block its own server with a uuid-minting `newId`. Add a local connector above the `it`s:
> ```ts
> async function connectP4() {
>   const { server } = buildServer({
>     registry: seededRegistry(projectRoot),
>     storeRoot: store,
>     now: () => TS,
>     newId: () => "e0000000-0000-4000-8000-000000000001",
>   });
>   const [clientT, serverT] = InMemoryTransport.createLinkedPair();
>   const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
>   await Promise.all([server.connect(serverT), client.connect(clientT)]);
>   return { client, server };
> }
> ```
> and use `connectP4()` in the two write cases. (The 15-tool list case can keep `connect`.) This keeps each write test to a single record, so the fixed uuid never collides.

- [ ] **Step 3: Apply the fix from the note if needed, then re-run**

Implement `connectP4()` as above if Step 2 failed on id validation. No production code changes — test-only.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: PASS (existing cases + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/test/server.e2e.test.ts
git commit -m "test(mcp-bridge): e2e for 15-tool surface + Phase 4 round-trips"
```

---

## Task 13: Full verification + changeset

**Files:**
- Create: `.changeset/phase4-mcp-server.md`

- [ ] **Step 1: Run the full monorepo gate**

Run: `pnpm -w turbo run test typecheck lint`
Expected: all packages PASS. If `@megasaver/core` or `@megasaver/mcp-bridge` fail typecheck on `exactOptionalPropertyTypes`, confirm every optional field is conditionally spread (`...(x !== undefined ? { x } : {})`) rather than passed as `undefined` — matching `save-memory.ts`.

- [ ] **Step 2: Verify the new tool count end-to-end (manual smoke, optional)**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e -t "lists 15 tools"`
Expected: PASS — confirms the wire surface is 15.

- [ ] **Step 3: Write the changeset**

Create `.changeset/phase4-mcp-server.md`:

```md
---
"@megasaver/shared": minor
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
---

Phase 4 — MCP Server full surface. Adds two first-class core entities
(ProjectRule, FailedAttempt) with schemas, branded ids, JSONL storage, and
registry CRUD, plus four MCP tools: `get_project_context`,
`record_failed_attempt`, `save_project_rule`, `get_project_rules`. The bridge
now exposes 15 tools. Additive only — no existing schema, store, or tool
changes shape.
```

> If the repo uses a different changeset format, match an existing file in `.changeset/`. If there is no `.changeset/` dir, skip this step and note the version bump in the PR body instead.

- [ ] **Step 4: Commit**

```bash
git add .changeset/phase4-mcp-server.md
git commit -m "chore: changeset for Phase 4 MCP server surface"
```

- [ ] **Step 5: Push the branch and open a PR (when ready)**

```bash
git push -u origin feat/phase4-mcp-server
```

Then open a PR titled `feat: Phase 4 — MCP Server full surface (11 -> 15 tools)` against `main`, linking the spec.

---

## Self-Review Notes

- **Spec coverage:** §3 ProjectRule → Task 2; §4 FailedAttempt → Task 3; §5 ids → Task 1; §6 registry → Tasks 4–7; §7 tools → Tasks 8–11; §10 testing → tests in every task + e2e Task 12. All spec sections map to a task.
- **Type consistency:** handler names (`handleRecordFailedAttempt`, `handleSaveProjectRule`, `handleGetProjectRules`, `handleGetProjectContext`) are identical in the tool file, server import, and tests. Registry methods (`createProjectRule`/`getProjectRule`/`listProjectRules`/`createFailedAttempt`/`getFailedAttempt`/`listFailedAttempts`) are identical across interface, both impls, and tests. Store helpers (`read/writeProjectRulesForProject`, `read/writeFailedAttemptsForProject`) match between Task 5 and Task 6.
- **No update/delete** for the new entities (spec §2) — none added.
- **Graceful no-index** in `get_project_context` is asserted (Task 10 + Task 12) since `readBlocks` returns `[]` on a missing index file.
