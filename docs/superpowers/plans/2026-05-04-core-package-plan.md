# `@megasaver/core` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first `@megasaver/core` foundation package with neutral domain schemas and a deterministic in-memory registry.

**Architecture:** `@megasaver/core` mirrors the existing `@megasaver/shared` package shape: strict ESM, one barrel export, Zod schemas, Vitest tests outside `src`, and tsup for build output. The package depends only on `@megasaver/shared` and `zod`; the registry stores parsed entities in memory and returns parsed copies to protect stored state.

**Tech Stack:** Node 22 · TypeScript strict ESM · pnpm workspaces · Turborepo · tsup · Vitest · Biome · Zod · fast-check.

**Spec:** [docs/superpowers/specs/2026-05-04-core-package-design.md](../specs/2026-05-04-core-package-design.md)

---

## File Structure

| Path | Role |
|---|---|
| `packages/core/package.json` | Workspace manifest. ESM, `private: true`, single `"."` export, runtime deps on `@megasaver/shared` and `zod`. |
| `packages/core/tsconfig.json` | Production TS config. Extends root config, `rootDir: src`, `outDir: dist`, excludes tests. |
| `packages/core/tsconfig.test.json` | Test TS config. Includes `src` and `test`, disables emit. |
| `packages/core/tsup.config.ts` | ESM-only build config with dts and sourcemap output. |
| `packages/core/vitest.config.ts` | Vitest config for `test/**/*.test.ts`. |
| `packages/core/src/index.ts` | Public barrel export. |
| `packages/core/src/errors.ts` | `CoreRegistryError`, error-code schema, and derived type. |
| `packages/core/src/project.ts` | `projectSchema` and `Project`. |
| `packages/core/src/session.ts` | `sessionSchema` and `Session`. |
| `packages/core/src/memory-entry.ts` | `memoryScopeSchema`, `memoryEntrySchema`, and derived types. |
| `packages/core/src/registry.ts` | `CoreRegistry` interface and `createInMemoryCoreRegistry()`. |
| `packages/core/test/smoke.test.ts` | Build pipeline smoke test. Removed after real tests land. |
| `packages/core/test/errors.test.ts` | Typed registry error tests. |
| `packages/core/test/project.test.ts` | Project schema tests. |
| `packages/core/test/session.test.ts` | Session schema tests. |
| `packages/core/test/memory-entry.test.ts` | Memory entry schema tests. |
| `packages/core/test/registry.test.ts` | In-memory registry behavior tests. |
| `.changeset/core-package-init.md` | Initial changeset for the new package. |
| `wiki/entities/core.md` | Add plan source and implementation status. |
| `wiki/log.md` | Append plan and implementation evidence entries. |

`pnpm-workspace.yaml` already includes `packages/*`, so no workspace glob change is needed.

---

## Task 1 - Scaffold the package and prove the test runner

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsconfig.test.json`
- Create: `packages/core/tsup.config.ts`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/test/smoke.test.ts`
- Create: `packages/core/src/index.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@megasaver/core",
  "version": "0.0.0",
  "private": true,
  "description": "Agent-agnostic ContextOps engine for Mega Saver.",
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
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@megasaver/shared": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "fast-check": "^3.23.2"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

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

- [ ] **Step 3: Create `packages/core/tsconfig.test.json`**

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

- [ ] **Step 4: Create `packages/core/tsup.config.ts`**

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

- [ ] **Step 5: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Install workspace dependencies from the repo root**

Run:

```bash
pnpm install
```

Expected: lockfile updates with a `packages/core` importer and the command exits 0.

- [ ] **Step 7: Write the failing smoke test**

Create `packages/core/test/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("@megasaver/core barrel", () => {
  it("loads without throwing", () => {
    expect(core).toBeDefined();
  });
});
```

- [ ] **Step 8: Run the smoke test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/smoke.test.ts
```

Expected: FAIL because `../src/index.js` cannot be resolved.

- [ ] **Step 9: Create the empty barrel**

Create `packages/core/src/index.ts`:

```ts
export {};
```

- [ ] **Step 10: Run the smoke test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/core test -- test/smoke.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 11: Run typecheck**

Run:

```bash
pnpm --filter @megasaver/core typecheck
```

Expected: `tsc -b --noEmit` exits 0.

- [ ] **Step 12: Run build**

Run:

```bash
pnpm --filter @megasaver/core build
```

Expected: `packages/core/dist/index.js`, `index.js.map`, and `index.d.ts` are emitted.

- [ ] **Step 13: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "chore(core): scaffold package"
```

---

## Task 2 - Typed registry errors

**Files:**
- Create: `packages/core/test/errors.test.ts`
- Create: `packages/core/src/errors.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/errors.test.ts`:

```ts
import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import {
  CoreRegistryError,
  type CoreRegistryErrorCode,
  coreRegistryErrorCodeSchema,
} from "../src/errors.js";

const codes: ReadonlyArray<CoreRegistryErrorCode> = [
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
];

describe("coreRegistryErrorCodeSchema", () => {
  it("parses every registry error code", () => {
    for (const code of codes) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects unknown error codes", () => {
    expect(coreRegistryErrorCodeSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("CoreRegistryError", () => {
  it("carries a stable name, code, and message", () => {
    const error = new CoreRegistryError(
      "project_not_found",
      "Project does not exist.",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CoreRegistryError");
    expect(error.code).toBe("project_not_found");
    expect(error.message).toBe("Project does not exist.");
  });

  it("validates the code at runtime", () => {
    expect(
      () => new CoreRegistryError("unknown" as CoreRegistryErrorCode, "Bad."),
    ).toThrow(ZodError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/errors.test.ts
```

Expected: FAIL because `../src/errors.js` cannot be resolved.

- [ ] **Step 3: Implement `packages/core/src/errors.ts`**

```ts
import { z } from "zod";

export const coreRegistryErrorCodeSchema = z.enum([
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
]);

export type CoreRegistryErrorCode = z.infer<
  typeof coreRegistryErrorCodeSchema
>;

export class CoreRegistryError extends Error {
  readonly code: CoreRegistryErrorCode;

  constructor(code: CoreRegistryErrorCode, message: string) {
    super(message);
    this.name = "CoreRegistryError";
    this.code = coreRegistryErrorCodeSchema.parse(code);
  }
}
```

- [ ] **Step 4: Export errors from the barrel**

Replace `packages/core/src/index.ts` with:

```ts
export * from "./errors.js";
```

- [ ] **Step 5: Run the errors test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/core test -- test/errors.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm --filter @megasaver/core typecheck
```

Expected: typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/index.ts packages/core/test/errors.test.ts
git commit -m "feat(core): add registry errors"
```

---

## Task 3 - `projectSchema`

**Files:**
- Create: `packages/core/test/project.test.ts`
- Create: `packages/core/src/project.ts`
- Modify: `packages/core/src/index.ts`
- Delete: `packages/core/test/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/project.test.ts`:

```ts
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type Project, projectSchema } from "../src/project.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = "2026-05-04T12:00:00.000Z";
const UPDATED_AT = "2026-05-04T12:05:00.000Z";

const validProject = {
  id: PROJECT_ID,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

describe("projectSchema", () => {
  it("parses a valid project", () => {
    expect(projectSchema.parse(validProject)).toEqual(validProject);
  });

  it("trims name and rootPath", () => {
    expect(
      projectSchema.parse({
        ...validProject,
        name: "  Mega Saver  ",
        rootPath: "  /tmp/mega  ",
      }),
    ).toMatchObject({
      name: "Mega Saver",
      rootPath: "/tmp/mega",
    });
  });

  it("rejects empty name and rootPath after trimming", () => {
    const result = projectSchema.safeParse({
      ...validProject,
      name: "   ",
      rootPath: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "name",
        "rootPath",
      ]);
    }
  });

  it("rejects invalid ids and datetimes", () => {
    const result = projectSchema.safeParse({
      ...validProject,
      id: "not-a-uuid",
      createdAt: "today",
      updatedAt: "later",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "id",
        "createdAt",
        "updatedAt",
      ]);
    }
  });

  it("property: non-empty names are accepted after trimming", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value.trim().length > 0),
        (name) => {
          expect(projectSchema.safeParse({ ...validProject, name }).success).toBe(
            true,
          );
        },
      ),
    );
  });

  it("exports the inferred Project type", () => {
    expectTypeOf<Project>().toMatchTypeOf<{
      id: string;
      name: string;
      rootPath: string;
      createdAt: string;
      updatedAt: string;
    }>();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/project.test.ts
```

Expected: FAIL because `../src/project.js` cannot be resolved.

- [ ] **Step 3: Build `@megasaver/shared` for the core import**

Run:

```bash
pnpm --filter @megasaver/shared build
```

Expected: shared build exits 0.

- [ ] **Step 4: Implement `packages/core/src/project.ts`**

```ts
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1),
    rootPath: z.string().trim().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
```

- [ ] **Step 5: Export project from the barrel and remove the smoke test**

Replace `packages/core/src/index.ts` with:

```ts
export * from "./errors.js";
export * from "./project.js";
```

Delete `packages/core/test/smoke.test.ts`.

- [ ] **Step 6: Run project tests to verify they pass**

Run:

```bash
pnpm --filter @megasaver/core test -- test/project.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Run all current core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: PASS, errors and project tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/project.ts packages/core/test/project.test.ts packages/core/test/smoke.test.ts
git commit -m "feat(core): add project schema"
```

---

## Task 4 - `sessionSchema`

**Files:**
- Create: `packages/core/test/session.test.ts`
- Create: `packages/core/src/session.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/session.test.ts`:

```ts
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type Session, sessionSchema } from "../src/session.js";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STARTED_AT = "2026-05-04T12:10:00.000Z";
const ENDED_AT = "2026-05-04T12:20:00.000Z";

const validSession = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  agentId: "claude-code",
  riskLevel: "high",
  title: "Implement core foundation",
  startedAt: STARTED_AT,
  endedAt: null,
};

describe("sessionSchema", () => {
  it("parses a valid active session", () => {
    expect(sessionSchema.parse(validSession)).toEqual(validSession);
  });

  it("parses a completed session", () => {
    expect(sessionSchema.parse({ ...validSession, endedAt: ENDED_AT })).toEqual({
      ...validSession,
      endedAt: ENDED_AT,
    });
  });

  it("allows a null title", () => {
    expect(sessionSchema.parse({ ...validSession, title: null }).title).toBe(
      null,
    );
  });

  it("trims non-null titles", () => {
    expect(
      sessionSchema.parse({ ...validSession, title: "  Core work  " }).title,
    ).toBe("Core work");
  });

  it("rejects empty titles after trimming", () => {
    const result = sessionSchema.safeParse({ ...validSession, title: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("rejects invalid ids, agent ids, risk levels, and datetimes", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      id: "not-a-uuid",
      projectId: "not-a-uuid",
      agentId: "codex",
      riskLevel: "extreme",
      startedAt: "now",
      endedAt: "later",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "id",
        "projectId",
        "agentId",
        "riskLevel",
        "startedAt",
        "endedAt",
      ]);
    }
  });

  it("property: any shipped v0.1 agent id is accepted", () => {
    fc.assert(
      fc.property(fc.constantFrom("claude-code", "generic-cli"), (agentId) => {
        expect(
          sessionSchema.safeParse({ ...validSession, agentId }).success,
        ).toBe(true);
      }),
    );
  });

  it("exports the inferred Session type", () => {
    expectTypeOf<Session>().toMatchTypeOf<{
      id: string;
      projectId: string;
      agentId: "claude-code" | "generic-cli";
      riskLevel: "low" | "medium" | "high" | "critical";
      title: string | null;
      startedAt: string;
      endedAt: string | null;
    }>();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/session.test.ts
```

Expected: FAIL because `../src/session.js` cannot be resolved.

- [ ] **Step 3: Build `@megasaver/shared`**

Run:

```bash
pnpm --filter @megasaver/shared build
```

Expected: shared build exits 0.

- [ ] **Step 4: Implement `packages/core/src/session.ts`**

```ts
import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const sessionSchema = z
  .object({
    id: sessionIdSchema,
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    riskLevel: riskLevelSchema,
    title: z.string().trim().min(1).nullable(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;
```

- [ ] **Step 5: Export session from the barrel**

Replace `packages/core/src/index.ts` with:

```ts
export * from "./errors.js";
export * from "./project.js";
export * from "./session.js";
```

- [ ] **Step 6: Run session tests to verify they pass**

Run:

```bash
pnpm --filter @megasaver/core test -- test/session.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Run all current core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: PASS, errors, project, and session tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/session.ts packages/core/test/session.test.ts
git commit -m "feat(core): add session schema"
```

---

## Task 5 - `memoryEntrySchema`

**Files:**
- Create: `packages/core/test/memory-entry.test.ts`
- Create: `packages/core/src/memory-entry.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/memory-entry.test.ts`:

```ts
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type MemoryEntry,
  type MemoryScope,
  memoryEntrySchema,
  memoryScopeSchema,
} from "../src/memory-entry.js";

const MEMORY_ENTRY_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-05-04T12:30:00.000Z";

const validProjectMemory = {
  id: MEMORY_ENTRY_ID,
  projectId: PROJECT_ID,
  sessionId: null,
  scope: "project",
  content: "Repo uses strict ESM.",
  createdAt: CREATED_AT,
};

const validSessionMemory = {
  ...validProjectMemory,
  sessionId: SESSION_ID,
  scope: "session",
};

describe("memoryScopeSchema", () => {
  it("parses project and session scopes", () => {
    expect(memoryScopeSchema.parse("project")).toBe("project");
    expect(memoryScopeSchema.parse("session")).toBe("session");
  });

  it("rejects unknown scopes", () => {
    expect(memoryScopeSchema.safeParse("global").success).toBe(false);
  });
});

describe("memoryEntrySchema", () => {
  it("parses project-scoped memory", () => {
    expect(memoryEntrySchema.parse(validProjectMemory)).toEqual(
      validProjectMemory,
    );
  });

  it("parses session-scoped memory", () => {
    expect(memoryEntrySchema.parse(validSessionMemory)).toEqual(
      validSessionMemory,
    );
  });

  it("trims content", () => {
    expect(
      memoryEntrySchema.parse({
        ...validProjectMemory,
        content: "  Keep evidence lines.  ",
      }).content,
    ).toBe("Keep evidence lines.");
  });

  it("rejects empty content after trimming", () => {
    const result = memoryEntrySchema.safeParse({
      ...validProjectMemory,
      content: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["content"]);
    }
  });

  it("requires sessionId for session-scoped memory", () => {
    const result = memoryEntrySchema.safeParse({
      ...validSessionMemory,
      sessionId: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["sessionId"]);
      expect(result.error.issues[0]?.message).toBe(
        "Session-scoped memory requires sessionId.",
      );
    }
  });

  it("forbids sessionId for project-scoped memory", () => {
    const result = memoryEntrySchema.safeParse({
      ...validProjectMemory,
      sessionId: SESSION_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["sessionId"]);
      expect(result.error.issues[0]?.message).toBe(
        "Project-scoped memory cannot include sessionId.",
      );
    }
  });

  it("rejects invalid ids and datetimes", () => {
    const result = memoryEntrySchema.safeParse({
      ...validProjectMemory,
      id: "not-a-uuid",
      projectId: "not-a-uuid",
      createdAt: "today",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "id",
        "projectId",
        "createdAt",
      ]);
    }
  });

  it("property: non-empty content is accepted after trimming", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value.trim().length > 0),
        (content) => {
          expect(
            memoryEntrySchema.safeParse({ ...validProjectMemory, content })
              .success,
          ).toBe(true);
        },
      ),
    );
  });

  it("exports inferred MemoryEntry and MemoryScope types", () => {
    expectTypeOf<MemoryScope>().toEqualTypeOf<"project" | "session">();
    expectTypeOf<MemoryEntry>().toMatchTypeOf<{
      id: string;
      projectId: string;
      sessionId: string | null;
      scope: "project" | "session";
      content: string;
      createdAt: string;
    }>();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/memory-entry.test.ts
```

Expected: FAIL because `../src/memory-entry.js` cannot be resolved.

- [ ] **Step 3: Build `@megasaver/shared`**

Run:

```bash
pnpm --filter @megasaver/shared build
```

Expected: shared build exits 0.

- [ ] **Step 4: Implement `packages/core/src/memory-entry.ts`**

```ts
import {
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const memoryScopeSchema = z.enum(["project", "session"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryEntrySchema = z
  .object({
    id: memoryEntryIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    scope: memoryScopeSchema,
    content: z.string().trim().min(1),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === null) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }

    if (entry.scope === "project" && entry.sessionId !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
```

- [ ] **Step 5: Export memory entry from the barrel**

Replace `packages/core/src/index.ts` with:

```ts
export * from "./errors.js";
export * from "./memory-entry.js";
export * from "./project.js";
export * from "./session.js";
```

- [ ] **Step 6: Run memory entry tests to verify they pass**

Run:

```bash
pnpm --filter @megasaver/core test -- test/memory-entry.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 7: Run all current core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: PASS, errors, project, session, and memory entry tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/memory-entry.ts packages/core/test/memory-entry.test.ts
git commit -m "feat(core): add memory schema"
```

---

## Task 6 - Registry project operations

**Files:**
- Create: `packages/core/test/registry.test.ts`
- Create: `packages/core/src/registry.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing project registry tests**

Create `packages/core/test/registry.test.ts`:

```ts
import { projectIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID_A = projectIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID_B = projectIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);

const projectA = {
  id: PROJECT_ID_A,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: "2026-05-04T12:00:00.000Z",
  updatedAt: "2026-05-04T12:05:00.000Z",
};

const projectB = {
  ...projectA,
  id: PROJECT_ID_B,
  name: "Another Project",
  rootPath: "/tmp/another",
};

describe("createInMemoryCoreRegistry project operations", () => {
  it("creates, gets, and lists projects in insertion order", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.createProject(projectA)).toEqual(projectA);
    expect(registry.createProject(projectB)).toEqual(projectB);

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.getProject(PROJECT_ID_B)).toEqual(projectB);
    expect(registry.listProjects()).toEqual([projectA, projectB]);
  });

  it("returns null for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
  });

  it("rejects duplicate project ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(() => registry.createProject(projectA)).toThrow(CoreRegistryError);
    try {
      registry.createProject(projectA);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_already_exists");
    }
  });

  it("validates projects before storing them", () => {
    const registry = createInMemoryCoreRegistry();

    expect(() =>
      registry.createProject({ ...projectA, name: "   " }),
    ).toThrow();
    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored projects", () => {
    const registry = createInMemoryCoreRegistry();
    const created = registry.createProject(projectA);

    created.name = "Mutated";

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.listProjects()).toEqual([projectA]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/registry.test.ts
```

Expected: FAIL because `../src/registry.js` cannot be resolved.

- [ ] **Step 3: Build `@megasaver/shared`**

Run:

```bash
pnpm --filter @megasaver/shared build
```

Expected: shared build exits 0.

- [ ] **Step 4: Implement project registry behavior**

Create `packages/core/src/registry.ts`:

```ts
import type { ProjectId } from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import { type Project, projectSchema } from "./project.js";

export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
}

export function createInMemoryCoreRegistry(): CoreRegistry {
  const projects = new Map<ProjectId, Project>();

  return {
    createProject(project) {
      const parsed = projectSchema.parse(project);
      if (projects.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_already_exists",
          `Project already exists: ${parsed.id}`,
        );
      }

      projects.set(parsed.id, parsed);
      return projectSchema.parse(parsed);
    },

    getProject(id) {
      const project = projects.get(id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return Array.from(projects.values(), (project) =>
        projectSchema.parse(project),
      );
    },
  };
}
```

- [ ] **Step 5: Export registry from the barrel**

Replace `packages/core/src/index.ts` with:

```ts
export * from "./errors.js";
export * from "./memory-entry.js";
export * from "./project.js";
export * from "./registry.js";
export * from "./session.js";
```

- [ ] **Step 6: Run registry tests to verify they pass**

Run:

```bash
pnpm --filter @megasaver/core test -- test/registry.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Run all current core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: PASS, all current core tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/registry.ts packages/core/test/registry.test.ts
git commit -m "feat(core): add project registry"
```

---

## Task 7 - Registry session operations

**Files:**
- Modify: `packages/core/test/registry.test.ts`
- Modify: `packages/core/src/registry.ts`

- [ ] **Step 1: Extend registry tests for sessions**

Replace `packages/core/test/registry.test.ts` with:

```ts
import {
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID_A = projectIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID_B = projectIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);
const SESSION_ID_A = sessionIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);
const SESSION_ID_B = sessionIdSchema.parse(
  "55555555-5555-4555-8555-555555555555",
);
const MISSING_SESSION_ID = sessionIdSchema.parse(
  "66666666-6666-4666-8666-666666666666",
);

const projectA = {
  id: PROJECT_ID_A,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: "2026-05-04T12:00:00.000Z",
  updatedAt: "2026-05-04T12:05:00.000Z",
};

const projectB = {
  ...projectA,
  id: PROJECT_ID_B,
  name: "Another Project",
  rootPath: "/tmp/another",
};

const sessionA = {
  id: SESSION_ID_A,
  projectId: PROJECT_ID_A,
  agentId: "claude-code",
  riskLevel: "high",
  title: "Core package",
  startedAt: "2026-05-04T12:10:00.000Z",
  endedAt: null,
} as const;

const sessionB = {
  ...sessionA,
  id: SESSION_ID_B,
  agentId: "generic-cli",
  riskLevel: "medium",
  title: null,
} as const;

describe("createInMemoryCoreRegistry project operations", () => {
  it("creates, gets, and lists projects in insertion order", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.createProject(projectA)).toEqual(projectA);
    expect(registry.createProject(projectB)).toEqual(projectB);

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.getProject(PROJECT_ID_B)).toEqual(projectB);
    expect(registry.listProjects()).toEqual([projectA, projectB]);
  });

  it("returns null for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
  });

  it("rejects duplicate project ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(() => registry.createProject(projectA)).toThrow(CoreRegistryError);
    try {
      registry.createProject(projectA);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_already_exists");
    }
  });

  it("validates projects before storing them", () => {
    const registry = createInMemoryCoreRegistry();

    expect(() =>
      registry.createProject({ ...projectA, name: "   " }),
    ).toThrow();
    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored projects", () => {
    const registry = createInMemoryCoreRegistry();
    const created = registry.createProject(projectA);

    created.name = "Mutated";

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.listProjects()).toEqual([projectA]);
  });
});

describe("createInMemoryCoreRegistry session operations", () => {
  it("creates, gets, and lists sessions for one project in insertion order", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(registry.createSession(sessionA)).toEqual(sessionA);
    expect(registry.createSession(sessionB)).toEqual(sessionB);

    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.getSession(SESSION_ID_B)).toEqual(sessionB);
    expect(registry.listSessions(PROJECT_ID_A)).toEqual([sessionA, sessionB]);
  });

  it("returns null for a missing session", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getSession(MISSING_SESSION_ID)).toBeNull();
  });

  it("rejects duplicate session ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createSession(sessionA);

    try {
      registry.createSession(sessionA);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("session_already_exists");
    }
  });

  it("rejects sessions whose project does not exist", () => {
    const registry = createInMemoryCoreRegistry();

    try {
      registry.createSession(sessionA);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_not_found");
    }
  });

  it("rejects listing sessions for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    try {
      registry.listSessions(PROJECT_ID_A);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_not_found");
    }
  });

  it("validates sessions before storing them", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(() =>
      registry.createSession({ ...sessionA, riskLevel: "extreme" } as never),
    ).toThrow();
    expect(registry.getSession(SESSION_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored sessions", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    const created = registry.createSession(sessionA);

    created.title = "Mutated";

    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.listSessions(PROJECT_ID_A)).toEqual([sessionA]);
  });
});
```

- [ ] **Step 2: Run the registry test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/registry.test.ts
```

Expected: FAIL because `createSession`, `getSession`, and `listSessions` are missing.

- [ ] **Step 3: Replace `packages/core/src/registry.ts` with project + session behavior**

```ts
import type { ProjectId, SessionId } from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import { type Project, projectSchema } from "./project.js";
import { type Session, sessionSchema } from "./session.js";

export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];
}

export function createInMemoryCoreRegistry(): CoreRegistry {
  const projects = new Map<ProjectId, Project>();
  const sessions = new Map<SessionId, Session>();

  const requireProject = (projectId: ProjectId): void => {
    if (!projects.has(projectId)) {
      throw new CoreRegistryError(
        "project_not_found",
        `Project does not exist: ${projectId}`,
      );
    }
  };

  return {
    createProject(project) {
      const parsed = projectSchema.parse(project);
      if (projects.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_already_exists",
          `Project already exists: ${parsed.id}`,
        );
      }

      projects.set(parsed.id, parsed);
      return projectSchema.parse(parsed);
    },

    getProject(id) {
      const project = projects.get(id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return Array.from(projects.values(), (project) =>
        projectSchema.parse(project),
      );
    },

    createSession(session) {
      const parsed = sessionSchema.parse(session);
      if (sessions.has(parsed.id)) {
        throw new CoreRegistryError(
          "session_already_exists",
          `Session already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);
      sessions.set(parsed.id, parsed);
      return sessionSchema.parse(parsed);
    },

    getSession(id) {
      const session = sessions.get(id);
      return session ? sessionSchema.parse(session) : null;
    },

    listSessions(projectId) {
      requireProject(projectId);
      return Array.from(sessions.values())
        .filter((session) => session.projectId === projectId)
        .map((session) => sessionSchema.parse(session));
    },
  };
}
```

- [ ] **Step 4: Run registry tests to verify they pass**

Run:

```bash
pnpm --filter @megasaver/core test -- test/registry.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Run all current core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: PASS, all current core tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/registry.ts packages/core/test/registry.test.ts
git commit -m "feat(core): add session registry"
```

---

## Task 8 - Registry memory entry operations

**Files:**
- Modify: `packages/core/test/registry.test.ts`
- Modify: `packages/core/src/registry.ts`

- [ ] **Step 1: Replace registry tests with the full required behavior**

Replace `packages/core/test/registry.test.ts` with:

```ts
import {
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID_A = projectIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID_B = projectIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);
const SESSION_ID_A = sessionIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);
const SESSION_ID_B = sessionIdSchema.parse(
  "55555555-5555-4555-8555-555555555555",
);
const MISSING_SESSION_ID = sessionIdSchema.parse(
  "66666666-6666-4666-8666-666666666666",
);
const MEMORY_ENTRY_ID_A = memoryEntryIdSchema.parse(
  "33333333-3333-4333-8333-333333333333",
);
const MEMORY_ENTRY_ID_B = memoryEntryIdSchema.parse(
  "77777777-7777-4777-8777-777777777777",
);
const MISSING_MEMORY_ENTRY_ID = memoryEntryIdSchema.parse(
  "88888888-8888-4888-8888-888888888888",
);

const projectA = {
  id: PROJECT_ID_A,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: "2026-05-04T12:00:00.000Z",
  updatedAt: "2026-05-04T12:05:00.000Z",
};

const projectB = {
  ...projectA,
  id: PROJECT_ID_B,
  name: "Another Project",
  rootPath: "/tmp/another",
};

const sessionA = {
  id: SESSION_ID_A,
  projectId: PROJECT_ID_A,
  agentId: "claude-code",
  riskLevel: "high",
  title: "Core package",
  startedAt: "2026-05-04T12:10:00.000Z",
  endedAt: null,
} as const;

const sessionB = {
  ...sessionA,
  id: SESSION_ID_B,
  projectId: PROJECT_ID_B,
  agentId: "generic-cli",
  riskLevel: "medium",
  title: null,
} as const;

const projectMemory = {
  id: MEMORY_ENTRY_ID_A,
  projectId: PROJECT_ID_A,
  sessionId: null,
  scope: "project",
  content: "Repo uses strict ESM.",
  createdAt: "2026-05-04T12:30:00.000Z",
} as const;

const sessionMemory = {
  ...projectMemory,
  id: MEMORY_ENTRY_ID_B,
  sessionId: SESSION_ID_A,
  scope: "session",
  content: "Core package spec is HIGH risk.",
} as const;

describe("createInMemoryCoreRegistry project operations", () => {
  it("creates, gets, and lists projects in insertion order", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.createProject(projectA)).toEqual(projectA);
    expect(registry.createProject(projectB)).toEqual(projectB);

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.getProject(PROJECT_ID_B)).toEqual(projectB);
    expect(registry.listProjects()).toEqual([projectA, projectB]);
  });

  it("returns null for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
  });

  it("rejects duplicate project ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    try {
      registry.createProject(projectA);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_already_exists");
    }
  });

  it("validates projects before storing them", () => {
    const registry = createInMemoryCoreRegistry();

    expect(() =>
      registry.createProject({ ...projectA, name: "   " }),
    ).toThrow();
    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored projects", () => {
    const registry = createInMemoryCoreRegistry();
    const created = registry.createProject(projectA);

    created.name = "Mutated";

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.listProjects()).toEqual([projectA]);
  });
});

describe("createInMemoryCoreRegistry session operations", () => {
  it("creates, gets, and lists sessions for one project in insertion order", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(registry.createSession(sessionA)).toEqual(sessionA);

    const secondSession = { ...sessionA, id: SESSION_ID_B };
    expect(registry.createSession(secondSession)).toEqual(secondSession);

    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.getSession(SESSION_ID_B)).toEqual(secondSession);
    expect(registry.listSessions(PROJECT_ID_A)).toEqual([
      sessionA,
      secondSession,
    ]);
  });

  it("returns null for a missing session", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getSession(MISSING_SESSION_ID)).toBeNull();
  });

  it("rejects duplicate session ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createSession(sessionA);

    try {
      registry.createSession(sessionA);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("session_already_exists");
    }
  });

  it("rejects sessions whose project does not exist", () => {
    const registry = createInMemoryCoreRegistry();

    try {
      registry.createSession(sessionA);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_not_found");
    }
  });

  it("rejects listing sessions for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    try {
      registry.listSessions(PROJECT_ID_A);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_not_found");
    }
  });

  it("validates sessions before storing them", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(() =>
      registry.createSession({ ...sessionA, riskLevel: "extreme" } as never),
    ).toThrow();
    expect(registry.getSession(SESSION_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored sessions", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    const created = registry.createSession(sessionA);

    created.title = "Mutated";

    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.listSessions(PROJECT_ID_A)).toEqual([sessionA]);
  });
});

describe("createInMemoryCoreRegistry memory entry operations", () => {
  it("creates, gets, and lists memory entries for one project in insertion order", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createSession(sessionA);

    expect(registry.createMemoryEntry(projectMemory)).toEqual(projectMemory);
    expect(registry.createMemoryEntry(sessionMemory)).toEqual(sessionMemory);

    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_B)).toEqual(sessionMemory);
    expect(registry.listMemoryEntries(PROJECT_ID_A)).toEqual([
      projectMemory,
      sessionMemory,
    ]);
  });

  it("returns null for a missing memory entry", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getMemoryEntry(MISSING_MEMORY_ENTRY_ID)).toBeNull();
  });

  it("rejects duplicate memory entry ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createMemoryEntry(projectMemory);

    try {
      registry.createMemoryEntry(projectMemory);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe(
        "memory_entry_already_exists",
      );
    }
  });

  it("rejects memory entries whose project does not exist", () => {
    const registry = createInMemoryCoreRegistry();

    try {
      registry.createMemoryEntry(projectMemory);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_not_found");
    }
  });

  it("rejects session-scoped memory whose session does not exist", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    try {
      registry.createMemoryEntry(sessionMemory);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("session_not_found");
    }
  });

  it("rejects session-scoped memory linked to a session in another project", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createProject(projectB);
    registry.createSession(sessionB);

    try {
      registry.createMemoryEntry(sessionMemory);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("session_project_mismatch");
    }
  });

  it("rejects listing memory entries for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    try {
      registry.listMemoryEntries(PROJECT_ID_A);
    } catch (error) {
      expect(error).toBeInstanceOf(CoreRegistryError);
      expect((error as CoreRegistryError).code).toBe("project_not_found");
    }
  });

  it("validates memory entries before storing them", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(() =>
      registry.createMemoryEntry({ ...projectMemory, content: "   " }),
    ).toThrow();
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored memory entries", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    const created = registry.createMemoryEntry(projectMemory);

    created.content = "Mutated";

    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
    expect(registry.listMemoryEntries(PROJECT_ID_A)).toEqual([projectMemory]);
  });
});
```

- [ ] **Step 2: Run the registry test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- test/registry.test.ts
```

Expected: FAIL because `createMemoryEntry`, `getMemoryEntry`, and `listMemoryEntries` are missing.

- [ ] **Step 3: Replace `packages/core/src/registry.ts` with the final registry**

```ts
import type {
  MemoryEntryId,
  ProjectId,
  SessionId,
} from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import { type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type Project, projectSchema } from "./project.js";
import { type Session, sessionSchema } from "./session.js";

export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];
  createMemoryEntry(entry: MemoryEntry): MemoryEntry;
  getMemoryEntry(id: MemoryEntryId): MemoryEntry | null;
  listMemoryEntries(projectId: ProjectId): MemoryEntry[];
}

export function createInMemoryCoreRegistry(): CoreRegistry {
  const projects = new Map<ProjectId, Project>();
  const sessions = new Map<SessionId, Session>();
  const memoryEntries = new Map<MemoryEntryId, MemoryEntry>();

  const requireProject = (projectId: ProjectId): void => {
    if (!projects.has(projectId)) {
      throw new CoreRegistryError(
        "project_not_found",
        `Project does not exist: ${projectId}`,
      );
    }
  };

  return {
    createProject(project) {
      const parsed = projectSchema.parse(project);
      if (projects.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_already_exists",
          `Project already exists: ${parsed.id}`,
        );
      }

      projects.set(parsed.id, parsed);
      return projectSchema.parse(parsed);
    },

    getProject(id) {
      const project = projects.get(id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return Array.from(projects.values(), (project) =>
        projectSchema.parse(project),
      );
    },

    createSession(session) {
      const parsed = sessionSchema.parse(session);
      if (sessions.has(parsed.id)) {
        throw new CoreRegistryError(
          "session_already_exists",
          `Session already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);
      sessions.set(parsed.id, parsed);
      return sessionSchema.parse(parsed);
    },

    getSession(id) {
      const session = sessions.get(id);
      return session ? sessionSchema.parse(session) : null;
    },

    listSessions(projectId) {
      requireProject(projectId);
      return Array.from(sessions.values())
        .filter((session) => session.projectId === projectId)
        .map((session) => sessionSchema.parse(session));
    },

    createMemoryEntry(entry) {
      const parsed = memoryEntrySchema.parse(entry);
      if (memoryEntries.has(parsed.id)) {
        throw new CoreRegistryError(
          "memory_entry_already_exists",
          `Memory entry already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);

      if (parsed.scope === "session") {
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

      memoryEntries.set(parsed.id, parsed);
      return memoryEntrySchema.parse(parsed);
    },

    getMemoryEntry(id) {
      const entry = memoryEntries.get(id);
      return entry ? memoryEntrySchema.parse(entry) : null;
    },

    listMemoryEntries(projectId) {
      requireProject(projectId);
      return Array.from(memoryEntries.values())
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => memoryEntrySchema.parse(entry));
    },
  };
}
```

- [ ] **Step 4: Run registry tests to verify they pass**

Run:

```bash
pnpm --filter @megasaver/core test -- test/registry.test.ts
```

Expected: PASS, 21 tests.

- [ ] **Step 5: Run all core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: PASS, all core tests.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm --filter @megasaver/core typecheck
```

Expected: typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/registry.ts packages/core/test/registry.test.ts
git commit -m "feat(core): add memory registry"
```

---

## Task 9 - Changeset, wiki evidence, and final verification

**Files:**
- Create: `.changeset/core-package-init.md`
- Modify: `wiki/entities/core.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Add the changeset**

Create `.changeset/core-package-init.md`:

```md
---
"@megasaver/core": minor
---

Initial release of `@megasaver/core` with neutral `Project`, `Session`, and `MemoryEntry` schemas plus `createInMemoryCoreRegistry()`.
```

- [ ] **Step 2: Update `wiki/entities/core.md`**

Replace the frontmatter with:

```md
---
title: '@megasaver/core'
tags: [entity, package, core-engine, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/plans/2026-05-04-core-package-plan.md
status: implemented-awaiting-review
created: 2026-05-04
updated: 2026-05-04
---
```

Keep the existing body and add this section before `## Related`:

```md
## Implementation evidence

- `pnpm --filter @megasaver/core test` passes.
- `pnpm --filter @megasaver/core typecheck` passes.
- `pnpm --filter @megasaver/core build` passes.
- `pnpm verify` passes before review.
```

- [ ] **Step 3: Append implementation evidence to `wiki/log.md`**

Append:

```md
## [2026-05-04] schema | core package implemented

Implemented the first `@megasaver/core` slice in `feat/core-package`: package scaffold, typed registry errors, `Project`, `Session`, and `MemoryEntry` schemas, and the deterministic in-memory registry. Added initial changeset `.changeset/core-package-init.md`. Evidence before review: `pnpm --filter @megasaver/core test`, `pnpm --filter @megasaver/core typecheck`, `pnpm --filter @megasaver/core build`, and `pnpm verify` all pass.
```

- [ ] **Step 4: Build `@megasaver/shared`**

Run:

```bash
pnpm --filter @megasaver/shared build
```

Expected: shared build exits 0.

- [ ] **Step 5: Run core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: all core test files pass.

- [ ] **Step 6: Run core typecheck**

Run:

```bash
pnpm --filter @megasaver/core typecheck
```

Expected: typecheck exits 0.

- [ ] **Step 7: Run core build**

Run:

```bash
pnpm --filter @megasaver/core build
```

Expected: build exits 0 and emits `packages/core/dist`.

- [ ] **Step 8: Run full verification**

Run:

```bash
pnpm verify
```

Expected: lint, typecheck, and test all pass.

- [ ] **Step 9: Commit**

```bash
git add .changeset/core-package-init.md wiki/entities/core.md wiki/log.md
git commit -m "docs(core): record implementation"
```

---

## Task 10 - External review gate

**Files:**
- No planned file edits unless review requests changes.

- [ ] **Step 1: Request review**

Use the required review workflow for HIGH risk work:

- `code-reviewer` pass.
- `critic` pass.

Review scope:

- `docs/superpowers/specs/2026-05-04-core-package-design.md`
- `docs/superpowers/plans/2026-05-04-core-package-plan.md`
- `packages/core/**`
- `.changeset/core-package-init.md`
- `wiki/entities/core.md`
- `wiki/index.md`
- `wiki/log.md`

- [ ] **Step 2: Address review feedback with receiving-code-review**

If review finds issues, use `superpowers:receiving-code-review` before edits.
For each accepted finding:

1. Write or update a failing test that exposes the issue.
2. Verify the test fails for the expected reason.
3. Implement the smallest fix.
4. Verify the test passes.
5. Re-run `pnpm verify`.
6. Commit with a focused message.

- [ ] **Step 3: Preserve final evidence**

Before PR or merge, capture:

```bash
pnpm verify
```

Expected: final full verification passes.

---

## Self-Review Checklist

- Spec coverage: tasks cover package scaffold, schemas, typed errors, registry behavior, changeset, wiki, verification, and external review.
- Placeholder scan: plan contains concrete file paths, code blocks, commands, and expected outcomes.
- Type consistency: public names match the spec: `Project`, `Session`, `MemoryEntry`, `CoreRegistryError`, and `createInMemoryCoreRegistry()`.
- Boundary check: no agent SDKs, CLI framework, storage library, tokenizer, compression library, or LLM SDK enters `@megasaver/core`.
