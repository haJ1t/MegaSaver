# Core Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON directory-backed `CoreRegistry` implementation to `@megasaver/core`.

**Architecture:** Keep the existing synchronous `CoreRegistry` contract and add `createJsonDirectoryCoreRegistry({ rootDir })` as a second implementation beside the in-memory registry. The registry reads the current on-disk JSON store on each operation, validates all loaded entities with the existing strict schemas, and writes changed files with temp-file plus rename. Filesystem and on-disk format failures use typed persistence errors while semantic registry failures continue using `CoreRegistryError`.

**Tech Stack:** TypeScript strict ESM, Node 22 built-in `node:fs` and `node:path`, Zod, Vitest, pnpm workspaces, tsup, Biome.

---

## File Structure

- Modify `packages/core/package.json`
  - Add explicit `@types/node` dev dependency because this feature imports Node built-ins from core source.
- Modify `packages/core/src/errors.ts`
  - Add `corePersistenceErrorCodeSchema`, `CorePersistenceErrorCode`, and `CorePersistenceError`.
- Modify `packages/core/src/index.ts`
  - Export the JSON directory registry module.
- Create `packages/core/src/json-directory-store.ts`
  - Internal filesystem helpers: root resolution, JSON/JSONL read, entity validation, and atomic writes.
- Create `packages/core/src/json-directory-registry.ts`
  - Public factory implementing `CoreRegistry` on top of the store helpers.
- Modify `packages/core/test/errors.test.ts`
  - Add persistence error schema and class tests.
- Create `packages/core/test/json-directory-registry.test.ts`
  - TDD coverage for factory options, empty store behavior, project/session/memory persistence, duplicate handling, and copy behavior.
- Create `packages/core/test/json-directory-registry-corrupt.test.ts`
  - TDD coverage for corrupt JSON, corrupt JSONL, and invalid stored entities without pushing the main registry test file over 300 LOC.
- Create `.changeset/core-persistence.md`
  - Record the public `@megasaver/core` surface addition.
- Modify `wiki/entities/core.md`
  - Add plan status and implementation-plan source.
- Modify `wiki/index.md`
  - Mark Core persistence plan phase.
- Modify `wiki/log.md`
  - Append the implementation plan entry.

## Task 1: Add Typed Persistence Errors

**Files:**
- Modify: `packages/core/src/errors.ts`
- Modify: `packages/core/test/errors.test.ts`

- [ ] **Step 1: Write the failing persistence error tests**

Update the import in `packages/core/test/errors.test.ts` to include the new symbols:

```ts
import {
  CorePersistenceError,
  type CorePersistenceErrorCode,
  CoreRegistryError,
  type CoreRegistryErrorCode,
  corePersistenceErrorCodeSchema,
  coreRegistryErrorCodeSchema,
} from "../src/errors.js";
```

Add this block after the existing `codes` constant:

```ts
const persistenceCodes: ReadonlyArray<CorePersistenceErrorCode> = [
  "store_root_invalid",
  "store_read_failed",
  "store_write_failed",
  "store_json_invalid",
  "store_entity_invalid",
];
```

Add these tests after the `CoreRegistryError` tests:

```ts
describe("corePersistenceErrorCodeSchema", () => {
  it("parses every persistence error code", () => {
    for (const code of persistenceCodes) {
      expect(corePersistenceErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects unknown persistence error codes", () => {
    expect(corePersistenceErrorCodeSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("CorePersistenceError", () => {
  it("carries a stable name, code, message, and file path", () => {
    const error = new CorePersistenceError("store_json_invalid", "Bad JSON.", {
      filePath: "/tmp/store/projects.json",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CorePersistenceError");
    expect(error.code).toBe("store_json_invalid");
    expect(error.message).toBe("Bad JSON.");
    expect(error.filePath).toBe("/tmp/store/projects.json");
  });

  it("defaults filePath to null", () => {
    const error = new CorePersistenceError("store_root_invalid", "Bad root.");

    expect(error.filePath).toBeNull();
  });

  it("validates the persistence code at runtime", () => {
    expect(
      () => new CorePersistenceError("unknown" as CorePersistenceErrorCode, "Bad."),
    ).toThrow(ZodError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- errors.test.ts
```

Expected: FAIL because `CorePersistenceError`, `CorePersistenceErrorCode`, and `corePersistenceErrorCodeSchema` are not exported from `errors.ts`.

- [ ] **Step 3: Implement the persistence error symbols**

Add this code to `packages/core/src/errors.ts` after `CoreRegistryError`:

```ts
export const corePersistenceErrorCodeSchema = z.enum([
  "store_root_invalid",
  "store_read_failed",
  "store_write_failed",
  "store_json_invalid",
  "store_entity_invalid",
]);

export type CorePersistenceErrorCode = z.infer<typeof corePersistenceErrorCodeSchema>;

export class CorePersistenceError extends Error {
  readonly code: CorePersistenceErrorCode;
  readonly filePath: string | null;

  constructor(
    code: CorePersistenceErrorCode,
    message: string,
    options?: { filePath?: string; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CorePersistenceError";
    this.code = corePersistenceErrorCodeSchema.parse(code);
    this.filePath = options?.filePath ?? null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/core test -- errors.test.ts
```

Expected: PASS for all `errors.test.ts` tests.

- [ ] **Step 5: Run typecheck for the package**

Run:

```bash
pnpm --filter @megasaver/core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/core/src/errors.ts packages/core/test/errors.test.ts
git commit -m "feat(core): add persistence errors"
```

## Task 2: Add JSON Store Happy Path

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/json-directory-store.ts`
- Create: `packages/core/src/json-directory-registry.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/json-directory-registry.test.ts`

- [ ] **Step 1: Write the failing JSON directory registry tests**

Create `packages/core/test/json-directory-registry.test.ts` with this initial coverage:

```ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CorePersistenceError, CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";

const PROJECT_ID_A = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const PROJECT_ID_B = projectIdSchema.parse("44444444-4444-4444-8444-444444444444");
const SESSION_ID_A = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const SESSION_ID_B = sessionIdSchema.parse("55555555-5555-4555-8555-555555555555");
const MEMORY_ENTRY_ID_A = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const MEMORY_ENTRY_ID_B = memoryEntryIdSchema.parse("77777777-7777-4777-8777-777777777777");
const MEMORY_ENTRY_ID_C = memoryEntryIdSchema.parse("99999999-9999-4999-8999-999999999999");

const roots: string[] = [];

function makeRoot(): string {
  const root = join(tmpdir(), `megasaver-core-${randomUUID()}`);
  roots.push(root);
  return root;
}

function expectRegistryError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(CoreRegistryError);
  expect((thrown as CoreRegistryError).code).toBe(code);
}

function expectPersistenceError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(CorePersistenceError);
  expect((thrown as CorePersistenceError).code).toBe(code);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const projectA = {
  id: PROJECT_ID_A,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: "2026-05-05T12:00:00.000Z",
  updatedAt: "2026-05-05T12:05:00.000Z",
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
  title: "Core persistence",
  startedAt: "2026-05-05T12:10:00.000Z",
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
  createdAt: "2026-05-05T12:30:00.000Z",
} as const;

const sessionMemory = {
  ...projectMemory,
  id: MEMORY_ENTRY_ID_B,
  sessionId: SESSION_ID_A,
  scope: "session",
  content: "Persistence spec is HIGH risk.",
} as const;

const otherProjectMemory = {
  ...projectMemory,
  id: MEMORY_ENTRY_ID_C,
  projectId: PROJECT_ID_B,
  content: "Second project memory.",
} as const;

describe("createJsonDirectoryCoreRegistry factory", () => {
  it("rejects an empty rootDir", () => {
    expectPersistenceError(
      () => createJsonDirectoryCoreRegistry({ rootDir: "   " }),
      "store_root_invalid",
    );
  });

  it("rejects an existing rootDir that is not a directory", () => {
    const root = makeRoot();
    writeFileSync(root, "not a directory");

    expectPersistenceError(
      () => createJsonDirectoryCoreRegistry({ rootDir: root }),
      "store_root_invalid",
    );
  });

  it("resolves relative rootDir values consistently", () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    const cwdRelative = relative(process.cwd(), root);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: cwdRelative });

    expect(registry.listProjects()).toEqual([]);
  });
});

describe("createJsonDirectoryCoreRegistry empty store reads", () => {
  it("treats a missing root as an empty store without creating files", () => {
    const root = makeRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expect(registry.listProjects()).toEqual([]);
    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
    expect(registry.getSession(SESSION_ID_A)).toBeNull();
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toBeNull();
    expect(existsSync(root)).toBe(false);
  });

  it("treats missing store files as empty", () => {
    const root = makeRoot();
    mkdirSync(join(root, "memory"), { recursive: true });
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expect(registry.listProjects()).toEqual([]);
    expect(registry.getSession(SESSION_ID_A)).toBeNull();
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toBeNull();
  });
});

describe("createJsonDirectoryCoreRegistry project persistence", () => {
  it("creates the root and persists projects across registry instances", () => {
    const root = makeRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expect(registry.createProject(projectA)).toEqual(projectA);
    expect(registry.createProject(projectB)).toEqual(projectB);

    expect(statSync(root).isDirectory()).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "projects.json"), "utf8"))).toEqual([
      projectA,
      projectB,
    ]);

    const reopened = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(reopened.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(reopened.listProjects()).toEqual([projectA, projectB]);
  });

  it("rejects duplicate project ids", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: makeRoot() });
    registry.createProject(projectA);

    expectRegistryError(() => registry.createProject(projectA), "project_already_exists");
  });
});

describe("createJsonDirectoryCoreRegistry session persistence", () => {
  it("persists sessions across registry instances and lists by project", () => {
    const root = makeRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject(projectA);
    registry.createProject(projectB);

    expect(registry.createSession(sessionA)).toEqual(sessionA);
    expect(registry.createSession(sessionB)).toEqual(sessionB);

    const reopened = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(reopened.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(reopened.listSessions(PROJECT_ID_A)).toEqual([sessionA]);
    expect(reopened.listSessions(PROJECT_ID_B)).toEqual([sessionB]);
  });

  it("rejects sessions whose project does not exist", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: makeRoot() });

    expectRegistryError(() => registry.createSession(sessionA), "project_not_found");
  });
});

describe("createJsonDirectoryCoreRegistry memory persistence", () => {
  it("persists project-scoped and session-scoped memory in project JSONL files", () => {
    const root = makeRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject(projectA);
    registry.createProject(projectB);
    registry.createSession(sessionA);

    expect(registry.createMemoryEntry(projectMemory)).toEqual(projectMemory);
    expect(registry.createMemoryEntry(sessionMemory)).toEqual(sessionMemory);
    expect(registry.createMemoryEntry(otherProjectMemory)).toEqual(otherProjectMemory);

    const projectMemoryFile = join(root, "memory", `${PROJECT_ID_A}.jsonl`);
    const fileLines = readFileSync(projectMemoryFile, "utf8").trimEnd().split("\n");
    expect(fileLines.map((line) => JSON.parse(line))).toEqual([projectMemory, sessionMemory]);

    const reopened = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(reopened.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
    expect(reopened.getMemoryEntry(MEMORY_ENTRY_ID_B)).toEqual(sessionMemory);
    expect(reopened.listMemoryEntries(PROJECT_ID_A)).toEqual([projectMemory, sessionMemory]);
    expect(reopened.listMemoryEntries(PROJECT_ID_B)).toEqual([otherProjectMemory]);
  });

  it("rejects missing parents and duplicate memory ids across project files", () => {
    const root = makeRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectRegistryError(() => registry.createMemoryEntry(projectMemory), "project_not_found");

    registry.createProject(projectA);
    registry.createProject(projectB);
    registry.createMemoryEntry(projectMemory);

    const duplicateInOtherProject = {
      ...otherProjectMemory,
      id: MEMORY_ENTRY_ID_A,
    };
    expectRegistryError(
      () => registry.createMemoryEntry(duplicateInOtherProject),
      "memory_entry_already_exists",
    );

    expectRegistryError(() => registry.createMemoryEntry(sessionMemory), "session_not_found");
  });
});

describe("createJsonDirectoryCoreRegistry copy behavior", () => {
  it("returns copies so callers cannot mutate stored entities", () => {
    const root = makeRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    const createdProject = registry.createProject(projectA);
    const createdSession = registry.createSession(sessionA);
    const createdMemory = registry.createMemoryEntry(projectMemory);

    createdProject.name = "Mutated";
    createdSession.title = "Mutated";
    createdMemory.content = "Mutated";

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/core test -- json-directory-registry.test.ts
```

Expected: FAIL because `../src/json-directory-registry.js` does not exist.

- [ ] **Step 3: Add the Node types dev dependency**

Modify `packages/core/package.json` so `devDependencies` includes `@types/node`:

```json
"devDependencies": {
  "@types/node": "^22.0.0",
  "fast-check": "^3.23.2"
}
```

Run:

```bash
pnpm install
```

Expected: lockfile remains consistent and `packages/core/package.json` records the explicit Node type dependency.

- [ ] **Step 4: Implement internal JSON directory store helpers**

Create `packages/core/src/json-directory-store.ts` with these exported helper responsibilities and names:

```ts
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { CorePersistenceError } from "./errors.js";
import { type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type Project, projectSchema } from "./project.js";
import { type Session, sessionSchema } from "./session.js";

export type StorePaths = {
  rootDir: string;
  projectsPath: string;
  sessionsPath: string;
  memoryDir: string;
};

export function resolveStorePaths(rootDir: string): StorePaths;
export function readProjects(paths: StorePaths): Project[];
export function writeProjects(paths: StorePaths, projects: readonly Project[]): void;
export function readSessions(paths: StorePaths): Session[];
export function writeSessions(paths: StorePaths, sessions: readonly Session[]): void;
export function readMemoryEntriesForProject(
  paths: StorePaths,
  projectId: ProjectId,
): MemoryEntry[];
export function readAllMemoryEntries(paths: StorePaths): MemoryEntry[];
export function writeMemoryEntriesForProject(
  paths: StorePaths,
  projectId: ProjectId,
  entries: readonly MemoryEntry[],
): void;
```

Implement the helpers with this behavior for the happy-path tests:

- `resolveStorePaths` trims and resolves `rootDir`; empty string or existing non-directory root throws `CorePersistenceError("store_root_invalid", "Store root is invalid.")`.
- Missing JSON files return `[]`.
- Valid JSON files parse to arrays.
- Valid JSONL files parse one JSON object per line.
- Valid loaded entities are parsed with `projectSchema`, `sessionSchema`, or `memoryEntrySchema`.
- `write*` functions serialize the complete next file content and call a private `atomicWriteFile(filePath, content)`.
- `atomicWriteFile` creates the parent directory, writes a temporary sibling file, and renames it over the target path.
- Read failures other than `ENOENT` throw `store_read_failed`.
- Write, mkdir, and rename failures throw `store_write_failed`.
- If a corrupt-file case is not needed by the current failing tests, keep the code simple and let Task 3 drive the typed-error wrapper with failing tests.

- [ ] **Step 5: Implement the JSON directory registry**

Create `packages/core/src/json-directory-registry.ts`:

```ts
import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import { type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type Project, projectSchema } from "./project.js";
import type { CoreRegistry } from "./registry.js";
import { type Session, sessionSchema } from "./session.js";
import {
  readAllMemoryEntries,
  readMemoryEntriesForProject,
  readProjects,
  readSessions,
  resolveStorePaths,
  writeMemoryEntriesForProject,
  writeProjects,
  writeSessions,
} from "./json-directory-store.js";

export type JsonDirectoryCoreRegistryOptions = {
  rootDir: string;
};

export function createJsonDirectoryCoreRegistry(
  options: JsonDirectoryCoreRegistryOptions,
): CoreRegistry {
  const paths = resolveStorePaths(options.rootDir);

  const requireProject = (projectId: ProjectId): void => {
    if (!readProjects(paths).some((project) => project.id === projectId)) {
      throw new CoreRegistryError("project_not_found", `Project does not exist: ${projectId}`);
    }
  };

  return {
    createProject(project: Project): Project {
      const parsed = projectSchema.parse(project);
      const projects = readProjects(paths);
      if (projects.some((existing) => existing.id === parsed.id)) {
        throw new CoreRegistryError(
          "project_already_exists",
          `Project already exists: ${parsed.id}`,
        );
      }

      writeProjects(paths, [...projects, parsed]);
      return projectSchema.parse(parsed);
    },

    getProject(id: ProjectId): Project | null {
      const project = readProjects(paths).find((candidate) => candidate.id === id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects(): Project[] {
      return readProjects(paths).map((project) => projectSchema.parse(project));
    },

    createSession(session: Session): Session {
      const parsed = sessionSchema.parse(session);
      const sessions = readSessions(paths);
      if (sessions.some((existing) => existing.id === parsed.id)) {
        throw new CoreRegistryError(
          "session_already_exists",
          `Session already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);
      writeSessions(paths, [...sessions, parsed]);
      return sessionSchema.parse(parsed);
    },

    getSession(id: SessionId): Session | null {
      const session = readSessions(paths).find((candidate) => candidate.id === id);
      return session ? sessionSchema.parse(session) : null;
    },

    listSessions(projectId: ProjectId): Session[] {
      requireProject(projectId);
      return readSessions(paths)
        .filter((session) => session.projectId === projectId)
        .map((session) => sessionSchema.parse(session));
    },

    createMemoryEntry(entry: MemoryEntry): MemoryEntry {
      const parsed = memoryEntrySchema.parse(entry);
      if (readAllMemoryEntries(paths).some((existing) => existing.id === parsed.id)) {
        throw new CoreRegistryError(
          "memory_entry_already_exists",
          `Memory entry already exists: ${parsed.id}`,
        );
      }

      requireProject(parsed.projectId);

      if (parsed.scope === "session" && parsed.sessionId !== null) {
        const session = readSessions(paths).find((candidate) => candidate.id === parsed.sessionId);
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

      const entries = readMemoryEntriesForProject(paths, parsed.projectId);
      writeMemoryEntriesForProject(paths, parsed.projectId, [...entries, parsed]);
      return memoryEntrySchema.parse(parsed);
    },

    getMemoryEntry(id: MemoryEntryId): MemoryEntry | null {
      const entry = readAllMemoryEntries(paths).find((candidate) => candidate.id === id);
      return entry ? memoryEntrySchema.parse(entry) : null;
    },

    listMemoryEntries(projectId: ProjectId): MemoryEntry[] {
      requireProject(projectId);
      return readMemoryEntriesForProject(paths, projectId).map((entry) =>
        memoryEntrySchema.parse(entry),
      );
    },
  };
}
```

- [ ] **Step 6: Export the registry from the package root**

Add this line to `packages/core/src/index.ts`:

```ts
export * from "./json-directory-registry.js";
```

- [ ] **Step 7: Run the test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/core test -- json-directory-registry.test.ts
```

Expected: PASS for the JSON directory registry test file.

- [ ] **Step 8: Run package typecheck**

Run:

```bash
pnpm --filter @megasaver/core typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add packages/core/package.json packages/core/src/index.ts packages/core/src/json-directory-store.ts packages/core/src/json-directory-registry.ts packages/core/test/json-directory-registry.test.ts pnpm-lock.yaml
git commit -m "feat(core): add json registry store"
```

## Task 3: Harden Corrupt Store Handling

**Files:**
- Modify: `packages/core/src/json-directory-store.ts`
- Create: `packages/core/test/json-directory-registry-corrupt.test.ts`

- [ ] **Step 1: Add failing corrupt store tests**

Create `packages/core/test/json-directory-registry-corrupt.test.ts`.
Do not append these tests to `json-directory-registry.test.ts`; that
file is already near the repo's 300 LOC limit after Task 2.

Use the same fixed IDs and fixture shape as
`json-directory-registry.test.ts`, but define only the fixtures needed
for corrupt-store cases. Include temp root cleanup via `afterEach`.

Add this test block:

```ts
describe("createJsonDirectoryCoreRegistry corrupt store handling", () => {
  it("throws a persistence error for invalid projects JSON", () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "projects.json"), "{bad");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.listProjects(), "store_json_invalid");
  });

  it("throws a persistence error for invalid sessions JSON", () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "sessions.json"), "{bad");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.getSession(SESSION_ID_A), "store_json_invalid");
  });

  it("throws a persistence error for invalid memory JSONL", () => {
    const root = makeRoot();
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(join(root, "memory", `${PROJECT_ID_A}.jsonl`), "{bad\n");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.getMemoryEntry(MEMORY_ENTRY_ID_A), "store_json_invalid");
  });

  it("throws a persistence error for schema-invalid stored projects", () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "projects.json"),
      JSON.stringify([{ ...projectA, name: "   " }], null, 2),
    );

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.listProjects(), "store_entity_invalid");
  });

  it("throws a persistence error for blank memory JSONL lines", () => {
    const root = makeRoot();
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(join(root, "memory", `${PROJECT_ID_A}.jsonl`), "\n");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.getMemoryEntry(MEMORY_ENTRY_ID_A), "store_json_invalid");
  });
});
```

- [ ] **Step 2: Run the test to verify failures expose missing hardening**

Run:

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-corrupt.test.ts
```

Expected: FAIL if any corrupt store case leaks a raw `SyntaxError`, `ZodError`, or non-typed filesystem error.

- [ ] **Step 3: Harden parse and validation wrappers**

In `packages/core/src/json-directory-store.ts`, ensure all JSON parse and schema parse operations are wrapped so callers only see `CorePersistenceError` for on-disk failures. Use this shape for private helpers:

```ts
function parseJson(text: string, filePath: string): unknown {
  if (text.length === 0) {
    throw new CorePersistenceError("store_json_invalid", `Store file is empty: ${filePath}`, {
      filePath,
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CorePersistenceError("store_json_invalid", `Store JSON is invalid: ${filePath}`, {
      filePath,
      cause: error,
    });
  }
}

function parseEntity<T>(schema: z.ZodType<T>, value: unknown, filePath: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new CorePersistenceError(
      "store_entity_invalid",
      `Store entity is invalid: ${filePath}`,
      { filePath, cause: error },
    );
  }
}
```

For JSONL parsing, reject blank lines before `JSON.parse`:

```ts
if (line.trim().length === 0) {
  throw new CorePersistenceError("store_json_invalid", `Store JSONL has a blank line: ${filePath}`, {
    filePath,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-corrupt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all core tests**

Run:

```bash
pnpm --filter @megasaver/core test
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/core/src/json-directory-store.ts packages/core/test/json-directory-registry-corrupt.test.ts
git commit -m "test(core): harden corrupt store cases"
```

## Task 4: Add Build Smoke and Changeset

**Files:**
- Create: `.changeset/core-persistence.md`
- Verify: `packages/core/dist/index.js`
- Verify: `packages/core/dist/index.d.ts`

- [ ] **Step 1: Add a changeset**

Create `.changeset/core-persistence.md`:

```md
---
"@megasaver/core": minor
---

Add JSON directory-backed CoreRegistry persistence.
```

- [ ] **Step 2: Build the package**

Run:

```bash
pnpm --filter @megasaver/core build
```

Expected: PASS and emit `packages/core/dist/index.js` plus `packages/core/dist/index.d.ts`.

- [ ] **Step 3: Smoke-check the public export**

Run:

```bash
node --input-type=module -e "import { createJsonDirectoryCoreRegistry } from './packages/core/dist/index.js'; const registry = createJsonDirectoryCoreRegistry({ rootDir: './.tmp-core-smoke' }); console.log(registry.listProjects().length);"
rm -rf .tmp-core-smoke
```

Expected: prints `0` and exits 0. The smoke command must not leave `.tmp-core-smoke` behind.

- [ ] **Step 4: Commit**

Run:

```bash
git add .changeset/core-persistence.md
git commit -m "chore(core): add persistence changeset"
```

## Task 5: Update Wiki Evidence

**Files:**
- Modify: `wiki/entities/core.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Update the core entity status**

In `wiki/entities/core.md`:

- Add `docs/superpowers/plans/2026-05-05-core-persistence-plan.md` under `sources`.
- Change `status` to `persistence-implemented`.
- Add implementation evidence bullets for:
  - `pnpm --filter @megasaver/core test`
  - `pnpm --filter @megasaver/core typecheck`
  - `pnpm --filter @megasaver/core build`
  - public export smoke with temp store directory

- [ ] **Step 2: Update the wiki index status**

In `wiki/index.md`, replace the current status paragraph with:

```md
Core persistence implementation phase. Bootstrap, project skeleton,
`@megasaver/shared`, `@megasaver/core`, and `@megasaver/cli` are
merged and pushed to `origin/main`; JSON directory persistence is
implemented in `feat/core-persistence` and awaiting review.
```

- [ ] **Step 3: Append the wiki log entry**

Append to `wiki/log.md`:

```md
## [2026-05-05] schema | core persistence implemented

Implemented JSON directory persistence for `@megasaver/core` in `feat/core-persistence`: caller-provided `rootDir`, `projects.json`, `sessions.json`, project memory JSONL files, temp-file plus rename writes, typed persistence errors, and package export. Evidence before review: `pnpm --filter @megasaver/core test`, `pnpm --filter @megasaver/core typecheck`, `pnpm --filter @megasaver/core build`, and a public export smoke command pass.
```

- [ ] **Step 4: Run docs lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add wiki/entities/core.md wiki/index.md wiki/log.md
git commit -m "docs(core): record persistence implementation"
```

## Task 6: Final Verification and External Review

**Files:**
- Inspect: full worktree diff
- No production file edits unless review finds issues

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm verify
```

Expected: PASS for lint, typecheck, and tests across all workspace packages.

- [ ] **Step 2: Run feature-specific smoke evidence**

Run:

```bash
pnpm --filter @megasaver/core build
node --input-type=module -e "import { createJsonDirectoryCoreRegistry } from './packages/core/dist/index.js'; const registry = createJsonDirectoryCoreRegistry({ rootDir: './.tmp-core-smoke' }); console.log(registry.listProjects().length);"
rm -rf .tmp-core-smoke
```

Expected: build exits 0, smoke prints `0`, and `.tmp-core-smoke` is removed.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff --stat main...HEAD
git diff --check
git status --short --branch
```

Expected: diff contains only the intended core persistence, changeset, spec/plan, and wiki files; `git diff --check` exits 0; worktree has no unstaged files.

- [ ] **Step 4: Request external reviews**

Request two fresh-context reviews before merge:

- `code-reviewer`: production readiness, TypeScript/ESM/package boundary, test quality, file-size convention, public API stability.
- `critic`: adversarial HIGH-risk review focused on data loss, store corruption, path handling, atomic write assumptions, agent-specific leaks, and missing evidence.

Expected: both reviewers return no Critical or Important findings before finishing the branch.

- [ ] **Step 5: Address review findings with receiving-code-review**

If either reviewer returns actionable findings, invoke `superpowers:receiving-code-review`, accept valid findings, fix with TDD where behavior changes, rerun focused tests, and commit fixes with a conventional caveman commit.

Expected: all accepted findings resolved and reviewers pass on re-check.

- [ ] **Step 6: Update wiki review evidence**

After both reviews pass, update `wiki/entities/core.md` status to `persistence-review-passed` and append a `wiki/log.md` entry naming the review result.

Run:

```bash
git add wiki/entities/core.md wiki/log.md
git commit -m "docs(core): record persistence review"
```

- [ ] **Step 7: Finish the branch**

Invoke `superpowers:verification-before-completion`, rerun `pnpm verify`, then invoke `superpowers:finishing-a-development-branch`.

Expected: branch completion offers merge/PR/keep/discard options only after fresh verification passes.
