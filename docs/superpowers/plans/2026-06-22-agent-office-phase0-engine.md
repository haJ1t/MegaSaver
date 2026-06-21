# Agent Office — Phase 0 (Engine: domain model + atomic-json store) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `@megasaver/agent-office` engine package's data layer — branded ids, zod-validated `Role` / `OfficeAgent` / `OfficeTask` domain models, an atomic-json store for each, and the predefined-role seed set — fully tested, with zero process-spawning.

**Architecture:** New agent-agnostic package `@megasaver/agent-office`. Phase 0 is the pure persistence/domain foundation: it depends only on `@megasaver/shared` (branded ids, `AgentId`, `titleSchema`) + `zod`. It mirrors `@megasaver/content-store` conventions exactly (atomic temp-file→fsync→rename writes, `assertSafeSegment` path confinement, zod validation on save and load, typed `AgentOfficeError`). Later phases (launcher, supervisor, bridge, GUI, CLI) build on this and get their own plans.

**Tech Stack:** TypeScript strict + ESM (NodeNext), zod 3, tsup, Vitest, fast-check (available as devDep), Biome, Turborepo, pnpm workspaces.

**Spec:** [docs/superpowers/specs/2026-06-22-agent-office-design.md](../specs/2026-06-22-agent-office-design.md) — §1 (domain model), §2 (persistence), §8 (safe-by-default permission policy).

**Risk:** This phase is **MEDIUM** (pure data layer, no spawning). The CRITICAL parts (process spawning, write-capable permission modes) arrive in Phase 1–2 and are gated there. Phase 0 only *encodes* the `permissionMode` field; it never acts on it.

**Convention notes for the implementer:**
- Run all commands from the repo root unless stated. Per-package: `pnpm --filter @megasaver/agent-office <script>`.
- Branded ids live in `@megasaver/shared/src/ids.ts` (this is where `projectIdSchema`, `taskPlanIdSchema`, etc. already live — follow that convention; do NOT create ids inside the office package).
- Every commit message ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- `atomic-write.ts` and `paths.ts` are intentionally near-duplicates of content-store's. We do NOT extract a shared util in this phase (that would touch content-store — out of scope). A follow-up could hoist `atomicWriteFile` + `assertSafeSegment` to `@megasaver/shared`; note it, don't do it now.
- `exactOptionalPropertyTypes: true` is on. Optional fields use zod `.optional()`; in tests/constructors **omit** optional keys rather than setting them to `undefined`.

---

## File Structure

Created in this phase:

```
packages/agent-office/
├─ package.json                 # @megasaver/agent-office, deps: shared + zod
├─ tsconfig.json                # extends ../../tsconfig.base.json
├─ tsconfig.test.json
├─ tsconfig.test-d.json
├─ tsup.config.ts
├─ vitest.config.ts
├─ src/
│  ├─ index.ts                  # public surface
│  ├─ errors.ts                 # AgentOfficeError + code enum
│  ├─ role.ts                   # roleSchema, Role, RolePermissionMode, RoleModel
│  ├─ agent.ts                  # officeAgentSchema, OfficeAgent, AgentStatus
│  ├─ task.ts                   # officeTaskSchema, OfficeTask, TaskStatus
│  ├─ atomic-write.ts           # atomicWriteFile (internal)
│  ├─ paths.ts                  # assertSafeSegment + path builders (internal)
│  ├─ role-store.ts             # saveRole/loadRole/listRoles/deleteRole
│  ├─ agent-store.ts            # saveAgent/loadAgent/listAgents/deleteAgent
│  ├─ task-store.ts             # saveTask/loadTask/listTasks/deleteTask
│  └─ predefined-roles.ts       # buildPredefinedRoles (pure seed set)
└─ test/
   ├─ role.test.ts
   ├─ agent.test.ts
   ├─ task.test.ts
   ├─ paths.test.ts
   ├─ atomic-write.test.ts
   ├─ role-store.test.ts
   ├─ agent-store.test.ts
   ├─ task-store.test.ts
   ├─ predefined-roles.test.ts
   └─ public-surface.test.ts
```

Modified in this phase:

```
packages/shared/src/ids.ts     # + roleId / officeAgentId / officeTaskId schemas
packages/shared/test/<id test> # + assertions for the new ids (see Task 2)
.changeset/<slug>.md           # new package + shared id additions
```

---

## Task 1: Scaffold `@megasaver/agent-office` package

**Files:**
- Create: `packages/agent-office/package.json`
- Create: `packages/agent-office/tsconfig.json`
- Create: `packages/agent-office/tsconfig.test.json`
- Create: `packages/agent-office/tsconfig.test-d.json`
- Create: `packages/agent-office/tsup.config.ts`
- Create: `packages/agent-office/vitest.config.ts`
- Create: `packages/agent-office/src/index.ts` (placeholder)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@megasaver/agent-office",
  "version": "0.0.0",
  "private": true,
  "description": "Agent Office engine — roster, roles, and per-agent task queues for Mega Saver.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@megasaver/shared": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.19.17",
    "fast-check": "^3.23.2"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "incremental": false,
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

- [ ] **Step 3: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `tsconfig.test-d.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noPropertyAccessFromIndexSignature": false
  },
  "include": ["src/**/*", "test/**/*.test-d.ts"],
  "exclude": ["dist", "node_modules", ".turbo"]
}
```

- [ ] **Step 5: Create `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts", "test/**/*.test-d.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test-d.json",
    },
  },
});
```

- [ ] **Step 7: Create placeholder `src/index.ts`**

```ts
export {};
```

- [ ] **Step 8: Install so pnpm links the new workspace package**

Run: `pnpm install`
Expected: completes; `@megasaver/agent-office` is linked (no errors about missing workspace package).

- [ ] **Step 9: Verify the package builds**

Run: `pnpm --filter @megasaver/agent-office build`
Expected: tsup emits `dist/index.js` + `dist/index.d.ts`, exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/agent-office pnpm-lock.yaml
git commit -m "chore(agent-office): scaffold engine package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add office branded ids to `@megasaver/shared`

**Files:**
- Modify: `packages/shared/src/ids.ts` (append after `toolDefinitionIdSchema`, around line 39)
- Test: `packages/shared/test/ids.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

Create or append to `packages/shared/test/ids.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  officeAgentIdSchema,
  officeTaskIdSchema,
  roleIdSchema,
} from "../src/ids.js";

describe("office branded ids", () => {
  it("accepts a lowercase uuid for each office id", () => {
    const id = randomUUID();
    expect(roleIdSchema.parse(id)).toBe(id);
    expect(officeAgentIdSchema.parse(id)).toBe(id);
    expect(officeTaskIdSchema.parse(id)).toBe(id);
  });

  it("rejects an uppercase uuid (case-aliasing guard)", () => {
    const upper = randomUUID().toUpperCase();
    expect(() => roleIdSchema.parse(upper)).toThrow();
    expect(() => officeAgentIdSchema.parse(upper)).toThrow();
    expect(() => officeTaskIdSchema.parse(upper)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/shared test`
Expected: FAIL — `officeAgentIdSchema`/`officeTaskIdSchema`/`roleIdSchema` are not exported.

- [ ] **Step 3: Add the schemas**

Append to `packages/shared/src/ids.ts` after the `toolDefinitionIdSchema` block (it reuses the file-local `lowercaseUuid` helper already defined at the top of `ids.ts`):

```ts
export const roleIdSchema = lowercaseUuid.brand<"RoleId">();
export type RoleId = z.infer<typeof roleIdSchema>;

export const officeAgentIdSchema = lowercaseUuid.brand<"OfficeAgentId">();
export type OfficeAgentId = z.infer<typeof officeAgentIdSchema>;

export const officeTaskIdSchema = lowercaseUuid.brand<"OfficeTaskId">();
export type OfficeTaskId = z.infer<typeof officeTaskIdSchema>;
```

(`packages/shared/src/index.ts` already does `export * from "./ids.js"`, so no index edit is needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/shared test`
Expected: PASS.

- [ ] **Step 5: Rebuild shared so dependents see the new exports**

Run: `pnpm --filter @megasaver/shared build`
Expected: exit 0, `dist` updated.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ids.ts packages/shared/test/ids.test.ts
git commit -m "feat(shared): add office roleId/agentId/taskId brands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `AgentOfficeError` + error-code enum

**Files:**
- Create: `packages/agent-office/src/errors.ts`
- Test: `packages/agent-office/test/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { AgentOfficeError, agentOfficeErrorCodeSchema } from "../src/errors.js";

describe("AgentOfficeError", () => {
  it("carries a typed code and defaults message to the code", () => {
    const err = new AgentOfficeError("not_found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentOfficeError");
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("not_found");
  });

  it("enumerates the four codes", () => {
    expect(agentOfficeErrorCodeSchema.options).toEqual([
      "not_found",
      "schema_invalid",
      "store_corrupt",
      "write_failed",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — module `../src/errors.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/errors.ts`:

```ts
import { z } from "zod";

export const agentOfficeErrorCodeSchema = z.enum([
  "not_found",
  "schema_invalid",
  "store_corrupt",
  "write_failed",
]);

export type AgentOfficeErrorCode = z.infer<typeof agentOfficeErrorCodeSchema>;

export class AgentOfficeError extends Error {
  readonly code: AgentOfficeErrorCode;

  constructor(code: AgentOfficeErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options);
    this.name = "AgentOfficeError";
    this.code = code;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/errors.ts packages/agent-office/test/errors.test.ts
git commit -m "feat(agent-office): add AgentOfficeError

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `Role` schema

**Files:**
- Create: `packages/agent-office/src/role.ts`
- Test: `packages/agent-office/test/role.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { roleIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type Role, roleSchema } from "../src/role.js";

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: roleIdSchema.parse(randomUUID()),
    name: "Architect",
    kind: "claude-code",
    persona: "You design systems and weigh trade-offs.",
    model: "opus",
    allowedTools: ["Read", "Grep"],
    skillPacks: [],
    permissionMode: "plan",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  } as Role;
}

describe("roleSchema", () => {
  it("accepts a valid role and an optional defaultWorkdir", () => {
    expect(roleSchema.parse(makeRole())).toMatchObject({ name: "Architect", permissionMode: "plan" });
    const withDir = roleSchema.parse(makeRole({ defaultWorkdir: "/repo" }));
    expect(withDir.defaultWorkdir).toBe("/repo");
  });

  it("rejects an unknown permission mode", () => {
    expect(() => roleSchema.parse(makeRole({ permissionMode: "yolo" as Role["permissionMode"] }))).toThrow();
  });

  it("rejects an unknown model", () => {
    expect(() => roleSchema.parse(makeRole({ model: "gpt" as Role["model"] }))).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => roleSchema.parse({ ...makeRole(), extra: 1 })).toThrow();
  });

  it("rejects a control-char name", () => {
    expect(() => roleSchema.parse(makeRole({ name: "badname" }))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/role.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/role.ts`:

```ts
import { agentIdSchema, roleIdSchema, titleSchema } from "@megasaver/shared";
import { z } from "zod";

export const rolePermissionModeSchema = z.enum(["plan", "acceptEdits", "full"]);
export type RolePermissionMode = z.infer<typeof rolePermissionModeSchema>;

export const roleModelSchema = z.enum(["opus", "sonnet", "haiku"]);
export type RoleModel = z.infer<typeof roleModelSchema>;

export const roleSchema = z
  .object({
    id: roleIdSchema,
    name: titleSchema,
    kind: agentIdSchema,
    persona: z.string(),
    model: roleModelSchema,
    allowedTools: z.array(z.string()).readonly(),
    skillPacks: z.array(z.string()).readonly(),
    permissionMode: rolePermissionModeSchema,
    defaultWorkdir: z.string().min(1).optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Role = z.infer<typeof roleSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/role.ts packages/agent-office/test/role.test.ts
git commit -m "feat(agent-office): add Role schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `OfficeAgent` schema

**Files:**
- Create: `packages/agent-office/src/agent.ts`
- Test: `packages/agent-office/test/agent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { officeAgentIdSchema, roleIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type OfficeAgent, agentStatusSchema, officeAgentSchema } from "../src/agent.js";

function makeAgent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: officeAgentIdSchema.parse(randomUUID()),
    name: "Archie",
    roleId: roleIdSchema.parse(randomUUID()),
    kind: "claude-code",
    workspaceKey: "0123456789abcdef",
    workdir: "/repo",
    status: "idle",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  } as OfficeAgent;
}

describe("officeAgentSchema", () => {
  it("accepts a valid idle agent without optional session ids", () => {
    expect(officeAgentSchema.parse(makeAgent())).toMatchObject({ status: "idle" });
  });

  it("accepts optional claudeSessionId and coreSessionId", () => {
    const parsed = officeAgentSchema.parse(
      makeAgent({ claudeSessionId: "sess-abc", coreSessionId: randomUUID() as OfficeAgent["coreSessionId"] }),
    );
    expect(parsed.claudeSessionId).toBe("sess-abc");
  });

  it("enumerates statuses alphabetically", () => {
    expect(agentStatusSchema.options).toEqual(["error", "idle", "paused", "stopped", "working"]);
  });

  it("rejects an unknown status", () => {
    expect(() => officeAgentSchema.parse(makeAgent({ status: "busy" as OfficeAgent["status"] }))).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => officeAgentSchema.parse({ ...makeAgent(), extra: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/agent.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/agent.ts`:

```ts
import { agentIdSchema, officeAgentIdSchema, roleIdSchema, sessionIdSchema } from "@megasaver/shared";
import { titleSchema } from "@megasaver/shared";
import { z } from "zod";

export const agentStatusSchema = z.enum(["error", "idle", "paused", "stopped", "working"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const officeAgentSchema = z
  .object({
    id: officeAgentIdSchema,
    name: titleSchema,
    roleId: roleIdSchema,
    kind: agentIdSchema,
    workspaceKey: z.string().min(1),
    workdir: z.string().min(1),
    status: agentStatusSchema,
    claudeSessionId: z.string().min(1).optional(),
    coreSessionId: sessionIdSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type OfficeAgent = z.infer<typeof officeAgentSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/agent.ts packages/agent-office/test/agent.test.ts
git commit -m "feat(agent-office): add OfficeAgent schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `OfficeTask` schema

**Files:**
- Create: `packages/agent-office/src/task.ts`
- Test: `packages/agent-office/test/task.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { officeAgentIdSchema, officeTaskIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type OfficeTask, officeTaskSchema, taskStatusSchema } from "../src/task.js";

function makeTask(overrides: Partial<OfficeTask> = {}): OfficeTask {
  return {
    id: officeTaskIdSchema.parse(randomUUID()),
    agentId: officeAgentIdSchema.parse(randomUUID()),
    workspaceKey: "0123456789abcdef",
    instruction: "Refactor the auth module.",
    status: "queued",
    queuedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  } as OfficeTask;
}

describe("officeTaskSchema", () => {
  it("accepts a queued task with no run timestamps", () => {
    expect(officeTaskSchema.parse(makeTask())).toMatchObject({ status: "queued" });
  });

  it("accepts a finished task with timestamps + exit code", () => {
    const parsed = officeTaskSchema.parse(
      makeTask({
        status: "done",
        startedAt: "2026-06-22T12:01:00.000Z",
        finishedAt: "2026-06-22T12:05:00.000Z",
        exitCode: 0,
      }),
    );
    expect(parsed.exitCode).toBe(0);
  });

  it("enumerates statuses alphabetically", () => {
    expect(taskStatusSchema.options).toEqual(["canceled", "done", "failed", "queued", "running"]);
  });

  it("rejects an empty instruction", () => {
    expect(() => officeTaskSchema.parse(makeTask({ instruction: "" }))).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => officeTaskSchema.parse({ ...makeTask(), extra: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/task.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/task.ts`:

```ts
import { officeAgentIdSchema, officeTaskIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const taskStatusSchema = z.enum(["canceled", "done", "failed", "queued", "running"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const officeTaskSchema = z
  .object({
    id: officeTaskIdSchema,
    agentId: officeAgentIdSchema,
    workspaceKey: z.string().min(1),
    instruction: z.string().min(1),
    status: taskStatusSchema,
    queuedAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).optional(),
    finishedAt: z.string().datetime({ offset: true }).optional(),
    exitCode: z.number().int().optional(),
    evidenceId: z.string().min(1).optional(),
  })
  .strict();

export type OfficeTask = z.infer<typeof officeTaskSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/task.ts packages/agent-office/test/task.test.ts
git commit -m "feat(agent-office): add OfficeTask schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Atomic write + path builders (`assertSafeSegment`)

**Files:**
- Create: `packages/agent-office/src/atomic-write.ts`
- Create: `packages/agent-office/src/paths.ts`
- Test: `packages/agent-office/test/atomic-write.test.ts`
- Test: `packages/agent-office/test/paths.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/agent-office/test/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AgentOfficeError } from "../src/errors.js";
import { agentPath, agentsDir, assertSafeSegment, rolePath, rolesDir, taskPath, tasksDir } from "../src/paths.js";

describe("assertSafeSegment", () => {
  it.each(["", ".", "..", "a/b", "a\\b"])("rejects %p", (seg) => {
    expect(() => assertSafeSegment(seg)).toThrow(AgentOfficeError);
  });
  it("accepts a normal segment", () => {
    expect(() => assertSafeSegment("abc-123")).not.toThrow();
  });
});

describe("path builders", () => {
  it("rolePath nests under office/roles", () => {
    expect(rolePath({ storeRoot: "/s", roleId: "r1" })).toBe("/s/office/roles/r1.json");
    expect(rolesDir("/s")).toBe("/s/office/roles");
  });
  it("agentPath nests under office/<wk>/agents", () => {
    expect(agentPath({ storeRoot: "/s", workspaceKey: "wk", officeAgentId: "a1" })).toBe(
      "/s/office/wk/agents/a1.json",
    );
    expect(agentsDir("/s", "wk")).toBe("/s/office/wk/agents");
  });
  it("taskPath nests under office/<wk>/tasks/<agent>", () => {
    expect(taskPath({ storeRoot: "/s", workspaceKey: "wk", officeAgentId: "a1", officeTaskId: "t1" })).toBe(
      "/s/office/wk/tasks/a1/t1.json",
    );
    expect(tasksDir("/s", "wk", "a1")).toBe("/s/office/wk/tasks/a1");
  });
  it("rejects an unsafe id segment", () => {
    expect(() => rolePath({ storeRoot: "/s", roleId: "../escape" })).toThrow(AgentOfficeError);
    expect(() => taskPath({ storeRoot: "/s", workspaceKey: "wk", officeAgentId: "a/b", officeTaskId: "t1" })).toThrow(
      AgentOfficeError,
    );
  });
});
```

`packages/agent-office/test/atomic-write.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "../src/atomic-write.js";
import { AgentOfficeError } from "../src/errors.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-office-aw-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  it("writes content, creating parent dirs", () => {
    const path = join(root, "a", "b", "file.json");
    atomicWriteFile(path, "hello\n");
    expect(readFileSync(path, "utf8")).toBe("hello\n");
  });

  it("overwrites existing content atomically", () => {
    const path = join(root, "file.json");
    atomicWriteFile(path, "one");
    atomicWriteFile(path, "two");
    expect(readFileSync(path, "utf8")).toBe("two");
  });

  it("rejects writing under a symlinked parent dir", () => {
    const realDir = join(root, "real");
    atomicWriteFile(join(realDir, "keep.json"), "x"); // creates realDir
    const linkDir = join(root, "link");
    symlinkSync(realDir, linkDir);
    expect(() => atomicWriteFile(join(linkDir, "f.json"), "y")).toThrow(AgentOfficeError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/atomic-write.js` and `../src/paths.js` not found.

- [ ] **Step 3: Implement `atomic-write.ts`**

`packages/agent-office/src/atomic-write.ts` (mirrors content-store; throws `AgentOfficeError`):

```ts
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { AgentOfficeError } from "./errors.js";

const IS_WIN32 = process.platform === "win32";

export function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new AgentOfficeError("write_failed", "Store write failed.");
    }

    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content);
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    if (!IS_WIN32) {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; surface the original write error.
    }
    if (error instanceof AgentOfficeError) throw error;
    throw new AgentOfficeError("write_failed", "Store write failed.", { cause: error });
  }
}
```

- [ ] **Step 4: Implement `paths.ts`**

`packages/agent-office/src/paths.ts`:

```ts
import { join } from "node:path";
import { AgentOfficeError } from "./errors.js";

export function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new AgentOfficeError("write_failed", `Unsafe path segment: ${segment}`);
  }
}

export function rolesDir(storeRoot: string): string {
  return join(storeRoot, "office", "roles");
}

export function rolePath(input: { storeRoot: string; roleId: string }): string {
  assertSafeSegment(input.roleId);
  return join(rolesDir(input.storeRoot), `${input.roleId}.json`);
}

export function agentsDir(storeRoot: string, workspaceKey: string): string {
  assertSafeSegment(workspaceKey);
  return join(storeRoot, "office", workspaceKey, "agents");
}

export function agentPath(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): string {
  assertSafeSegment(input.officeAgentId);
  return join(agentsDir(input.storeRoot, input.workspaceKey), `${input.officeAgentId}.json`);
}

export function tasksDir(storeRoot: string, workspaceKey: string, officeAgentId: string): string {
  assertSafeSegment(workspaceKey);
  assertSafeSegment(officeAgentId);
  return join(storeRoot, "office", workspaceKey, "tasks", officeAgentId);
}

export function taskPath(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  officeTaskId: string;
}): string {
  assertSafeSegment(input.officeTaskId);
  return join(
    tasksDir(input.storeRoot, input.workspaceKey, input.officeAgentId),
    `${input.officeTaskId}.json`,
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS (all paths + atomic-write tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent-office/src/atomic-write.ts packages/agent-office/src/paths.ts packages/agent-office/test/atomic-write.test.ts packages/agent-office/test/paths.test.ts
git commit -m "feat(agent-office): add atomic write + path builders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Role store (save/load/list/delete)

**Files:**
- Create: `packages/agent-office/src/role-store.ts`
- Test: `packages/agent-office/test/role-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roleIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentOfficeError } from "../src/errors.js";
import { rolePath, rolesDir } from "../src/paths.js";
import { type Role, roleSchema } from "../src/role.js";
import { deleteRole, listRoles, loadRole, saveRole } from "../src/role-store.js";

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "agent-office-roles-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function makeRole(overrides: Partial<Role> = {}): Role {
  return roleSchema.parse({
    id: roleIdSchema.parse(randomUUID()),
    name: "Architect",
    kind: "claude-code",
    persona: "Design systems.",
    model: "opus",
    allowedTools: [],
    skillPacks: [],
    permissionMode: "plan",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  });
}

describe("role store", () => {
  it("round-trips a saved role", async () => {
    const role = makeRole();
    await saveRole({ storeRoot, role });
    expect(await loadRole({ storeRoot, roleId: role.id })).toEqual(role);
  });

  it("throws not_found for a missing role", async () => {
    await expect(loadRole({ storeRoot, roleId: roleIdSchema.parse(randomUUID()) })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("lists saved roles and returns [] when none exist", async () => {
    expect(await listRoles({ storeRoot })).toEqual([]);
    const a = makeRole();
    const b = makeRole();
    await saveRole({ storeRoot, role: a });
    await saveRole({ storeRoot, role: b });
    const ids = (await listRoles({ storeRoot })).map((r) => r.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("deletes a role (idempotent)", async () => {
    const role = makeRole();
    await saveRole({ storeRoot, role });
    await deleteRole({ storeRoot, roleId: role.id });
    await expect(loadRole({ storeRoot, roleId: role.id })).rejects.toMatchObject({ code: "not_found" });
    await deleteRole({ storeRoot, roleId: role.id }); // no throw second time
  });

  it("throws store_corrupt for a non-json file", async () => {
    const role = makeRole();
    const path = rolePath({ storeRoot, roleId: role.id });
    // ensure dir exists by saving then clobbering
    await saveRole({ storeRoot, role });
    writeFileSync(path, "{ not json");
    await expect(loadRole({ storeRoot, roleId: role.id })).rejects.toBeInstanceOf(AgentOfficeError);
    expect(rolesDir(storeRoot)).toContain("office");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/role-store.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/role-store.ts`:

```ts
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { rolePath, rolesDir } from "./paths.js";
import { type Role, roleSchema } from "./role.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseRoleFile(path: string, raw: string): Role {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt role file: ${path}`, { cause: error });
  }
  try {
    return roleSchema.parse(parsed);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt role file: ${path}`, { cause: error });
  }
}

export async function saveRole(input: { storeRoot: string; role: Role }): Promise<void> {
  let role: Role;
  try {
    role = roleSchema.parse(input.role);
  } catch (error) {
    throw new AgentOfficeError("schema_invalid", "Role is invalid.", { cause: error });
  }
  const path = rolePath({ storeRoot: input.storeRoot, roleId: role.id });
  atomicWriteFile(path, `${JSON.stringify(role, null, 2)}\n`);
}

export async function loadRole(input: { storeRoot: string; roleId: string }): Promise<Role> {
  const path = rolePath({ storeRoot: input.storeRoot, roleId: input.roleId });
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new AgentOfficeError("not_found", `Role not found: ${input.roleId}`);
    }
    throw error;
  }
  return parseRoleFile(path, raw);
}

export async function listRoles(input: { storeRoot: string }): Promise<readonly Role[]> {
  const dir = rolesDir(input.storeRoot);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const roles: Role[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    roles.push(parseRoleFile(path, readFileSync(path, "utf8")));
  }
  return roles;
}

export async function deleteRole(input: { storeRoot: string; roleId: string }): Promise<void> {
  const path = rolePath({ storeRoot: input.storeRoot, roleId: input.roleId });
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new AgentOfficeError("write_failed", `Delete failed: ${input.roleId}`, { cause: error });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/role-store.ts packages/agent-office/test/role-store.test.ts
git commit -m "feat(agent-office): add role store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Agent store (save/load/list/delete)

**Files:**
- Create: `packages/agent-office/src/agent-store.ts`
- Test: `packages/agent-office/test/agent-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officeAgentIdSchema, roleIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OfficeAgent, officeAgentSchema } from "../src/agent.js";
import { deleteAgent, listAgents, loadAgent, saveAgent } from "../src/agent-store.js";

let storeRoot: string;
const workspaceKey = "0123456789abcdef";
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "agent-office-agents-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function makeAgent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return officeAgentSchema.parse({
    id: officeAgentIdSchema.parse(randomUUID()),
    name: "Archie",
    roleId: roleIdSchema.parse(randomUUID()),
    kind: "claude-code",
    workspaceKey,
    workdir: "/repo",
    status: "idle",
    createdAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  });
}

describe("agent store", () => {
  it("round-trips a saved agent", async () => {
    const agent = makeAgent();
    await saveAgent({ storeRoot, agent });
    expect(await loadAgent({ storeRoot, workspaceKey, officeAgentId: agent.id })).toEqual(agent);
  });

  it("throws not_found for a missing agent", async () => {
    await expect(
      loadAgent({ storeRoot, workspaceKey, officeAgentId: officeAgentIdSchema.parse(randomUUID()) }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists agents scoped to a workspace and returns [] when none exist", async () => {
    expect(await listAgents({ storeRoot, workspaceKey })).toEqual([]);
    const a = makeAgent();
    await saveAgent({ storeRoot, agent: a });
    const ids = (await listAgents({ storeRoot, workspaceKey })).map((x) => x.id);
    expect(ids).toEqual([a.id]);
  });

  it("deletes an agent (idempotent)", async () => {
    const agent = makeAgent();
    await saveAgent({ storeRoot, agent });
    await deleteAgent({ storeRoot, workspaceKey, officeAgentId: agent.id });
    await expect(
      loadAgent({ storeRoot, workspaceKey, officeAgentId: agent.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await deleteAgent({ storeRoot, workspaceKey, officeAgentId: agent.id });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/agent-store.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/agent-store.ts`:

```ts
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type OfficeAgent, officeAgentSchema } from "./agent.js";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { agentPath, agentsDir } from "./paths.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseAgentFile(path: string, raw: string): OfficeAgent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt agent file: ${path}`, { cause: error });
  }
  try {
    return officeAgentSchema.parse(parsed);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt agent file: ${path}`, { cause: error });
  }
}

export async function saveAgent(input: { storeRoot: string; agent: OfficeAgent }): Promise<void> {
  let agent: OfficeAgent;
  try {
    agent = officeAgentSchema.parse(input.agent);
  } catch (error) {
    throw new AgentOfficeError("schema_invalid", "Agent is invalid.", { cause: error });
  }
  const path = agentPath({
    storeRoot: input.storeRoot,
    workspaceKey: agent.workspaceKey,
    officeAgentId: agent.id,
  });
  atomicWriteFile(path, `${JSON.stringify(agent, null, 2)}\n`);
}

export async function loadAgent(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): Promise<OfficeAgent> {
  const path = agentPath(input);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new AgentOfficeError("not_found", `Agent not found: ${input.officeAgentId}`);
    }
    throw error;
  }
  return parseAgentFile(path, raw);
}

export async function listAgents(input: {
  storeRoot: string;
  workspaceKey: string;
}): Promise<readonly OfficeAgent[]> {
  const dir = agentsDir(input.storeRoot, input.workspaceKey);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const agents: OfficeAgent[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    agents.push(parseAgentFile(path, readFileSync(path, "utf8")));
  }
  return agents;
}

export async function deleteAgent(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): Promise<void> {
  const path = agentPath(input);
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new AgentOfficeError("write_failed", `Delete failed: ${input.officeAgentId}`, { cause: error });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/agent-store.ts packages/agent-office/test/agent-store.test.ts
git commit -m "feat(agent-office): add agent store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Task store (per-agent queue)

**Files:**
- Create: `packages/agent-office/src/task-store.ts`
- Test: `packages/agent-office/test/task-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officeAgentIdSchema, officeTaskIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OfficeTask, officeTaskSchema } from "../src/task.js";
import { deleteTask, listTasks, loadTask, saveTask } from "../src/task-store.js";

let storeRoot: string;
const workspaceKey = "0123456789abcdef";
const agentId = officeAgentIdSchema.parse(randomUUID());
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "agent-office-tasks-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function makeTask(overrides: Partial<OfficeTask> = {}): OfficeTask {
  return officeTaskSchema.parse({
    id: officeTaskIdSchema.parse(randomUUID()),
    agentId,
    workspaceKey,
    instruction: "Do the thing.",
    status: "queued",
    queuedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  });
}

describe("task store", () => {
  it("round-trips a saved task", async () => {
    const task = makeTask();
    await saveTask({ storeRoot, task });
    expect(await loadTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id })).toEqual(task);
  });

  it("throws not_found for a missing task", async () => {
    await expect(
      loadTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: officeTaskIdSchema.parse(randomUUID()) }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists tasks for one agent and returns [] when none exist", async () => {
    expect(await listTasks({ storeRoot, workspaceKey, officeAgentId: agentId })).toEqual([]);
    const a = makeTask();
    const b = makeTask({ status: "done", exitCode: 0 });
    await saveTask({ storeRoot, task: a });
    await saveTask({ storeRoot, task: b });
    const ids = (await listTasks({ storeRoot, workspaceKey, officeAgentId: agentId })).map((t) => t.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("scopes listing to the requested agent only", async () => {
    const otherAgent = officeAgentIdSchema.parse(randomUUID());
    await saveTask({ storeRoot, task: makeTask() });
    expect(await listTasks({ storeRoot, workspaceKey, officeAgentId: otherAgent })).toEqual([]);
  });

  it("deletes a task (idempotent)", async () => {
    const task = makeTask();
    await saveTask({ storeRoot, task });
    await deleteTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id });
    await expect(
      loadTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await deleteTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/task-store.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/task-store.ts`:

```ts
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { taskPath, tasksDir } from "./paths.js";
import { type OfficeTask, officeTaskSchema } from "./task.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseTaskFile(path: string, raw: string): OfficeTask {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt task file: ${path}`, { cause: error });
  }
  try {
    return officeTaskSchema.parse(parsed);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt task file: ${path}`, { cause: error });
  }
}

export async function saveTask(input: { storeRoot: string; task: OfficeTask }): Promise<void> {
  let task: OfficeTask;
  try {
    task = officeTaskSchema.parse(input.task);
  } catch (error) {
    throw new AgentOfficeError("schema_invalid", "Task is invalid.", { cause: error });
  }
  const path = taskPath({
    storeRoot: input.storeRoot,
    workspaceKey: task.workspaceKey,
    officeAgentId: task.agentId,
    officeTaskId: task.id,
  });
  atomicWriteFile(path, `${JSON.stringify(task, null, 2)}\n`);
}

export async function loadTask(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  officeTaskId: string;
}): Promise<OfficeTask> {
  const path = taskPath(input);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new AgentOfficeError("not_found", `Task not found: ${input.officeTaskId}`);
    }
    throw error;
  }
  return parseTaskFile(path, raw);
}

export async function listTasks(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): Promise<readonly OfficeTask[]> {
  const dir = tasksDir(input.storeRoot, input.workspaceKey, input.officeAgentId);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const tasks: OfficeTask[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    tasks.push(parseTaskFile(path, readFileSync(path, "utf8")));
  }
  return tasks;
}

export async function deleteTask(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  officeTaskId: string;
}): Promise<void> {
  const path = taskPath(input);
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new AgentOfficeError("write_failed", `Delete failed: ${input.officeTaskId}`, { cause: error });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/task-store.ts packages/agent-office/test/task-store.test.ts
git commit -m "feat(agent-office): add task store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Predefined-role seed set

**Files:**
- Create: `packages/agent-office/src/predefined-roles.ts`
- Test: `packages/agent-office/test/predefined-roles.test.ts`

**Design note:** `buildPredefinedRoles` is **pure** — it takes injected `now` (ISO string) and `newId` (id factory) so tests are deterministic (mirrors the CLI `RunXInput` now/newId convention). Seeding-to-disk is wired in a later phase (CLI/supervisor). Every predefined role ships with `permissionMode: "plan"` — the spec §8 safe-by-default rule; the user opts a role up to `acceptEdits`/`full` later.

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
import { roleSchema } from "../src/role.js";
import { describe, expect, it } from "vitest";
import { buildPredefinedRoles } from "../src/predefined-roles.js";

const now = "2026-06-22T12:00:00.000Z";

describe("buildPredefinedRoles", () => {
  it("returns a non-empty set of schema-valid roles", () => {
    const roles = buildPredefinedRoles({ now, newId: () => randomUUID() });
    expect(roles.length).toBeGreaterThanOrEqual(8);
    for (const role of roles) {
      expect(() => roleSchema.parse(role)).not.toThrow();
    }
  });

  it("makes every predefined role safe-by-default (permissionMode plan)", () => {
    const roles = buildPredefinedRoles({ now, newId: () => randomUUID() });
    expect(roles.every((r) => r.permissionMode === "plan")).toBe(true);
  });

  it("includes the core roster names", () => {
    const names = buildPredefinedRoles({ now, newId: () => randomUUID() }).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["Architect", "Executor", "Code Reviewer", "Critic", "Debugger", "Verifier"]),
    );
  });

  it("uses the injected id factory and now", () => {
    let i = 0;
    const roles = buildPredefinedRoles({ now, newId: () => `00000000-0000-4000-8000-00000000000${i++}` });
    expect(roles[0]?.createdAt).toBe(now);
    expect(roles[0]?.id).toBe("00000000-0000-4000-8000-000000000000");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `../src/predefined-roles.js` not found.

- [ ] **Step 3: Write minimal implementation**

`packages/agent-office/src/predefined-roles.ts`:

```ts
import { roleIdSchema } from "@megasaver/shared";
import { type Role, roleSchema } from "./role.js";
import type { RoleModel } from "./role.js";

type Seed = { name: string; model: RoleModel; persona: string };

// Seeded from CLAUDE.md §6 agent roster. permissionMode is always "plan"
// (spec §8 safe-by-default); the user opts a role up to acceptEdits/full.
const SEEDS: readonly Seed[] = [
  { name: "Architect", model: "opus", persona: "Design systems and weigh trade-offs. Produce plans, not edits." },
  { name: "Executor", model: "sonnet", persona: "Implement changes per an approved plan, surgically." },
  { name: "Code Reviewer", model: "sonnet", persona: "Review diffs for correctness, clarity, and convention drift." },
  { name: "Critic", model: "opus", persona: "Adversarially challenge a design or change; find what breaks." },
  { name: "Debugger", model: "sonnet", persona: "Isolate root cause from a failing test or repro, then propose a fix." },
  { name: "Verifier", model: "sonnet", persona: "Check completion against the Definition of Done with evidence." },
  { name: "Writer", model: "haiku", persona: "Write docs, READMEs, and comments. Keep it terse and accurate." },
  { name: "Security Reviewer", model: "opus", persona: "OWASP and secrets sweep; flag injection, path, and auth risks." },
  { name: "Test Engineer", model: "sonnet", persona: "Design test strategy; harden flaky tests; cover edge cases." },
];

export function buildPredefinedRoles(input: { now: string; newId: () => string }): Role[] {
  return SEEDS.map((seed) =>
    roleSchema.parse({
      id: roleIdSchema.parse(input.newId()),
      name: seed.name,
      kind: "claude-code",
      persona: seed.persona,
      model: seed.model,
      allowedTools: [],
      skillPacks: [],
      permissionMode: "plan",
      createdAt: input.now,
    } satisfies Role),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-office/src/predefined-roles.ts packages/agent-office/test/predefined-roles.test.ts
git commit -m "feat(agent-office): add predefined role seed set

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Public surface (`index.ts`) + changeset + full verify

**Files:**
- Modify: `packages/agent-office/src/index.ts`
- Test: `packages/agent-office/test/public-surface.test.ts`
- Create: `.changeset/agent-office-phase0.md`

- [ ] **Step 1: Write the failing test**

`packages/agent-office/test/public-surface.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("public surface", () => {
  it("exports schemas, types-by-value, error, stores, and the seed builder", () => {
    for (const name of [
      "roleSchema",
      "rolePermissionModeSchema",
      "roleModelSchema",
      "officeAgentSchema",
      "agentStatusSchema",
      "officeTaskSchema",
      "taskStatusSchema",
      "AgentOfficeError",
      "agentOfficeErrorCodeSchema",
      "saveRole",
      "loadRole",
      "listRoles",
      "deleteRole",
      "saveAgent",
      "loadAgent",
      "listAgents",
      "deleteAgent",
      "saveTask",
      "loadTask",
      "listTasks",
      "deleteTask",
      "buildPredefinedRoles",
    ]) {
      expect(api).toHaveProperty(name);
    }
  });

  it("does NOT export internal path/atomic-write helpers", () => {
    expect(api).not.toHaveProperty("atomicWriteFile");
    expect(api).not.toHaveProperty("assertSafeSegment");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: FAIL — `index.ts` is the placeholder; named exports missing.

- [ ] **Step 3: Write the public surface**

Replace `packages/agent-office/src/index.ts` with:

```ts
export {
  roleSchema,
  rolePermissionModeSchema,
  roleModelSchema,
  type Role,
  type RolePermissionMode,
  type RoleModel,
} from "./role.js";

export {
  officeAgentSchema,
  agentStatusSchema,
  type OfficeAgent,
  type AgentStatus,
} from "./agent.js";

export {
  officeTaskSchema,
  taskStatusSchema,
  type OfficeTask,
  type TaskStatus,
} from "./task.js";

export {
  AgentOfficeError,
  agentOfficeErrorCodeSchema,
  type AgentOfficeErrorCode,
} from "./errors.js";

export { saveRole, loadRole, listRoles, deleteRole } from "./role-store.js";
export { saveAgent, loadAgent, listAgents, deleteAgent } from "./agent-store.js";
export { saveTask, loadTask, listTasks, deleteTask } from "./task-store.js";
export { buildPredefinedRoles } from "./predefined-roles.js";
```

(`atomic-write.ts` and `paths.ts` are intentionally NOT re-exported — internal.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/agent-office test`
Expected: PASS.

- [ ] **Step 5: Create the changeset**

`.changeset/agent-office-phase0.md`:

```md
---
"@megasaver/agent-office": minor
"@megasaver/shared": minor
---

Add the Agent Office engine data layer: Role / OfficeAgent / OfficeTask
schemas, atomic-json stores, and the predefined-role seed set. Adds
roleId / officeAgentId / officeTaskId branded ids to @megasaver/shared.
```

- [ ] **Step 6: Build the package (so dependents/dts are current)**

Run: `pnpm --filter @megasaver/agent-office build`
Expected: exit 0; `dist/index.js` + `dist/index.d.ts` emitted.

- [ ] **Step 7: Run the full DoD gate (lint + typecheck + test)**

Run: `pnpm verify`
Expected: Biome clean, `tsc -b --noEmit` clean, all Vitest suites pass (including the new agent-office suites and the shared id test). If Biome reports formatting, run `pnpm lint:fix` and re-stage.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-office/src/index.ts packages/agent-office/test/public-surface.test.ts .changeset/agent-office-phase0.md
git commit -m "feat(agent-office): expose public surface + changeset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 0 Definition of Done

- [ ] `pnpm verify` green (Biome, tsc, Vitest).
- [ ] `@megasaver/agent-office` builds and exports the surface in Task 12.
- [ ] All store round-trips, not_found, store_corrupt, and path-safety tests pass.
- [ ] Every predefined role is `permissionMode: "plan"` (safe-by-default, spec §8).
- [ ] Changeset added.
- [ ] External reviewer agent pass (`code-reviewer`) — author ≠ reviewer context.
- [ ] Verifier agent pass with evidence.

## What Phase 0 deliberately does NOT do (next phases)

- **Phase 1:** `AgentLauncher` interface + claude-code adapter (spawn `claude -p --output-format stream-json --resume`; the CRITICAL spawning part — isolated, fake-child-process tested).
- **Phase 2:** Supervisor (queue loop, lifecycle, resume continuity, concurrency cap) + per-role permission/workdir enforcement + evidence-ledger audit. Composes `@megasaver/core` `CoreRegistry` (the no-core-import constraint does NOT apply to this package long-term).
- **Phase 3:** Bridge `/api/office` routes + reuse of `tailTranscript`/SSE.
- **Phase 4:** GUI office board view + role manager.
- **Phase 5:** CLI `mega office` commands.

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 0 slice):** §1 domain model → Tasks 2,4,5,6 (ids, Role, OfficeAgent, OfficeTask). §2 persistence (atomic-json, `assertSafeSegment`, hierarchical layout) → Tasks 7,8,9,10. §8 safe-by-default `permissionMode: "plan"` → encoded in Task 4 schema + enforced for seeds in Task 11. Predefined roster (§1) → Task 11. Launcher/supervisor/bridge/GUI/CLI are explicitly deferred to Phases 1–5 (own plans).

**Placeholder scan:** None. (Task 2 Step 3 contains an explicit "do NOT add the placeholder" correction — that is intentional guidance, the final code block after it is authoritative.)

**Type consistency:** `Role`/`OfficeAgent`/`OfficeTask` field names and store signatures are identical across the schema task, store task, and tests. `officeAgentSchema`/`officeTaskSchema`/`roleSchema` names match between definition, stores, and `index.ts`. Branded id names (`roleIdSchema`, `officeAgentIdSchema`, `officeTaskIdSchema`) match the shared additions in Task 2. Path-builder names (`rolePath`, `agentPath`, `taskPath`, `rolesDir`, `agentsDir`, `tasksDir`) match between `paths.ts`, the stores, and `paths.test.ts`.
