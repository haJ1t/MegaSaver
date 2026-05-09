import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
const otherProjectMemory = {
  ...projectMemory,
  id: MEMORY_ENTRY_ID_C,
  projectId: PROJECT_ID_B,
  content: "Other project memory.",
} as const;
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const root = join(tmpdir(), `megasaver-json-store-${randomUUID()}`);
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

describe("createJsonDirectoryCoreRegistry factory", () => {
  it("rejects an empty rootDir", () => {
    expectPersistenceError(
      () => createJsonDirectoryCoreRegistry({ rootDir: "   " }),
      "store_root_invalid",
    );
  });

  it("rejects an existing root path that is a file", () => {
    const root = createTempRoot();
    writeFileSync(root, "not a directory");
    expectPersistenceError(
      () => createJsonDirectoryCoreRegistry({ rootDir: root }),
      "store_root_invalid",
    );
  });

  it("preserves trailing-space rootDir path characters", () => {
    const baseRoot = createTempRoot();
    const rootWithSpace = `${baseRoot} `;
    roots.push(rootWithSpace);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: rootWithSpace });

    registry.createProject(projectA);

    expect(existsSync(join(rootWithSpace, "projects.json"))).toBe(true);
    expect(existsSync(join(baseRoot, "projects.json"))).toBe(false);
  });

  it("resolves relative rootDir values consistently and returns empty projects", () => {
    const root = createTempRoot();
    const relativeRoot = resolve(root, "..", root.split("/").at(-1) ?? "");
    const registry = createJsonDirectoryCoreRegistry({ rootDir: relativeRoot });
    expect(registry.listProjects()).toEqual([]);
  });
});

describe("createJsonDirectoryCoreRegistry empty store reads", () => {
  it("treats a missing root as empty and read operations do not create files", () => {
    const root = createTempRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
    expect(registry.getSession(SESSION_ID_A)).toBeNull();
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toBeNull();
    expect(registry.listProjects()).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });

  it("treats missing store files inside an existing root as empty", () => {
    const root = createTempRoot();
    mkdirSync(root);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(registry.listProjects()).toEqual([]);
    expect(registry.getSession(SESSION_ID_A)).toBeNull();
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toBeNull();
  });
});

describe("createJsonDirectoryCoreRegistry project persistence", () => {
  it("creates root and persists projects across registry instances", () => {
    const root = createTempRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(registry.createProject(projectA)).toEqual(projectA);
    expect(existsSync(root)).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "projects.json"), "utf8"))).toEqual([projectA]);
    const nextRegistry = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(nextRegistry.getProject(PROJECT_ID_A)).toEqual(projectA);
  });

  it("lists projects in insertion order", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    registry.createProject(projectA);
    registry.createProject(projectB);
    expect(registry.listProjects()).toEqual([projectA, projectB]);
  });

  it("rejects duplicate project ids", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    registry.createProject(projectA);
    expectRegistryError(() => registry.createProject(projectA), "project_already_exists");
  });
});

describe("createJsonDirectoryCoreRegistry session persistence", () => {
  it("persists sessions across registry instances and lists by project", () => {
    const root = createTempRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject(projectA);
    registry.createProject(projectB);
    expect(registry.createSession(sessionA)).toEqual(sessionA);
    expect(registry.createSession(sessionB)).toEqual(sessionB);
    const nextRegistry = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(nextRegistry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(nextRegistry.listSessions(PROJECT_ID_A)).toEqual([sessionA]);
    expect(nextRegistry.listSessions(PROJECT_ID_B)).toEqual([sessionB]);
  });

  it("rejects sessions for missing projects", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    expectRegistryError(() => registry.createSession(sessionA), "project_not_found");
  });
});

describe("createJsonDirectoryCoreRegistry memory persistence", () => {
  it("writes memory entries to a project JSONL file", () => {
    const root = createTempRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject(projectA);
    expect(registry.createMemoryEntry(projectMemory)).toEqual(projectMemory);
    const lines = readFileSync(join(root, "memory", `${PROJECT_ID_A}.jsonl`), "utf8")
      .trim()
      .split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual([projectMemory]);
  });

  it("persists project-scoped and session-scoped memory across registry instances", () => {
    const root = createTempRoot();
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject(projectA);
    const createdSession = registry.createSession(sessionA);
    const createdMemory = registry.createMemoryEntry(projectMemory);
    expect(createdSession).toEqual(sessionA);
    expect(createdMemory).toEqual(projectMemory);
    expect(registry.createMemoryEntry(sessionMemory)).toEqual(sessionMemory);
    const nextRegistry = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(nextRegistry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
    expect(nextRegistry.getMemoryEntry(MEMORY_ENTRY_ID_B)).toEqual(sessionMemory);
    expect(nextRegistry.listMemoryEntries(PROJECT_ID_A)).toEqual([projectMemory, sessionMemory]);
  });

  it("lists memory entries per project in insertion order", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    registry.createProject(projectA);
    registry.createProject(projectB);
    registry.createMemoryEntry(projectMemory);
    registry.createMemoryEntry(otherProjectMemory);
    registry.createSession(sessionA);
    registry.createMemoryEntry(sessionMemory);
    expect(registry.listMemoryEntries(PROJECT_ID_A)).toEqual([projectMemory, sessionMemory]);
    expect(registry.listMemoryEntries(PROJECT_ID_B)).toEqual([otherProjectMemory]);
  });

  it("rejects memory entries for missing projects", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    expectRegistryError(() => registry.createMemoryEntry(projectMemory), "project_not_found");
  });

  it("rejects duplicate memory ids across project files", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    const duplicateInProjectB = {
      ...otherProjectMemory,
      id: MEMORY_ENTRY_ID_A,
    };
    registry.createProject(projectA);
    registry.createProject(projectB);
    registry.createMemoryEntry(projectMemory);
    expectRegistryError(
      () => registry.createMemoryEntry(duplicateInProjectB),
      "memory_entry_already_exists",
    );
  });

  it("rejects session-scoped memory with a missing session", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    registry.createProject(projectA);
    expectRegistryError(() => registry.createMemoryEntry(sessionMemory), "session_not_found");
  });
});

describe("createJsonDirectoryCoreRegistry copy behavior", () => {
  it("returns project, session, and memory copies", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: createTempRoot() });
    const createdProject = registry.createProject(projectA);
    const createdSession = registry.createSession(sessionA);
    const createdMemory = registry.createMemoryEntry(projectMemory);
    createdProject.name = "Mutated";
    createdSession.title = "Mutated";
    createdMemory.content = "Mutated";
    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);

    const listedProject = registry.listProjects()[0];
    const listedSession = registry.listSessions(PROJECT_ID_A)[0];
    const listedMemory = registry.listMemoryEntries(PROJECT_ID_A)[0];
    if (!listedProject || !listedSession || !listedMemory) {
      throw new Error("Expected stored entities to exist.");
    }
    listedProject.name = "Listed project mutation";
    listedSession.title = "Listed session mutation";
    listedMemory.content = "Listed memory mutation";
    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
  });
});

describe("updateSession (json-directory)", () => {
  const PROJECT_ID = projectIdSchema.parse("33333333-3333-4333-8333-333333333333");
  const SESSION_ID = sessionIdSchema.parse("44444444-4444-4444-8444-444444444444");
  const TS = "2026-05-09T00:00:00.000Z";
  const ENDED_TS = "2026-05-09T01:00:00.000Z";

  function buildRegistry() {
    const root = createTempRoot();
    const reg = createJsonDirectoryCoreRegistry({ rootDir: root });
    reg.createProject({
      id: PROJECT_ID,
      name: "test project",
      rootPath: "/tmp/test",
      createdAt: TS,
      updatedAt: TS,
    });
    reg.createSession({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: null,
      startedAt: TS,
      endedAt: null,
    });
    return { reg, root };
  }

  it("persists title change to sessions.json on disk", () => {
    const { reg, root } = buildRegistry();
    reg.updateSession(SESSION_ID, { title: "auth refactor" });
    const arr = JSON.parse(readFileSync(join(root, "sessions.json"), "utf8")) as Array<{
      title: string | null;
    }>;
    expect(arr[0]?.title).toBe("auth refactor");
  });

  it("persists null clear on disk", () => {
    const { reg, root } = buildRegistry();
    reg.updateSession(SESSION_ID, { title: "first" });
    reg.updateSession(SESSION_ID, { title: null });
    const arr = JSON.parse(readFileSync(join(root, "sessions.json"), "utf8")) as Array<{
      title: string | null;
    }>;
    expect(arr[0]?.title).toBeNull();
  });

  it("persists multi-field patch on disk", () => {
    const { reg, root } = buildRegistry();
    const updated = reg.updateSession(SESSION_ID, {
      title: "x",
      riskLevel: "high",
      agentId: "cursor",
    });
    expect(updated.title).toBe("x");
    expect(updated.riskLevel).toBe("high");
    expect(updated.agentId).toBe("cursor");
    const arr = JSON.parse(readFileSync(join(root, "sessions.json"), "utf8")) as Array<{
      title: string | null;
      riskLevel: string;
      agentId: string;
    }>;
    expect(arr[0]?.title).toBe("x");
    expect(arr[0]?.riskLevel).toBe("high");
    expect(arr[0]?.agentId).toBe("cursor");
  });

  it("throws Zod error on empty patch", () => {
    const { reg } = buildRegistry();
    expect(() => reg.updateSession(SESSION_ID, {})).toThrow(/at least one field/);
  });

  it("throws session_not_found for unknown id", () => {
    const { reg } = buildRegistry();
    expectRegistryError(
      () =>
        reg.updateSession(sessionIdSchema.parse("99999999-9999-4999-8999-999999999999"), {
          title: "x",
        }),
      "session_not_found",
    );
  });

  it("throws session_already_ended for ended session", () => {
    const { reg } = buildRegistry();
    reg.endSession(SESSION_ID, { endedAt: ENDED_TS });
    expect(() => reg.updateSession(SESSION_ID, { title: "x" })).toThrow(/already ended/);
  });
});
