import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { CoreRegistryError, type CoreRegistryErrorCode } from "../src/errors.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID_A = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const PROJECT_ID_B = projectIdSchema.parse("44444444-4444-4444-8444-444444444444");
const SESSION_ID_A = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const SESSION_ID_B = sessionIdSchema.parse("55555555-5555-4555-8555-555555555555");
const MISSING_SESSION_ID = sessionIdSchema.parse("66666666-6666-4666-8666-666666666666");
const MEMORY_ENTRY_ID_A = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const MEMORY_ENTRY_ID_B = memoryEntryIdSchema.parse("77777777-7777-4777-8777-777777777777");
const MISSING_MEMORY_ENTRY_ID = memoryEntryIdSchema.parse("88888888-8888-4888-8888-888888888888");

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

const sessionAInProjectB = {
  ...sessionA,
  projectId: PROJECT_ID_B,
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

function expectRegistryError(action: () => unknown, code: CoreRegistryErrorCode): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(CoreRegistryError);
  expect((thrown as CoreRegistryError).code).toBe(code);
}

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

    expectRegistryError(() => registry.createProject(projectA), "project_already_exists");
  });

  it("validates projects before storing them", () => {
    const registry = createInMemoryCoreRegistry();

    expect(() => registry.createProject({ ...projectA, name: "   " })).toThrow();
    expect(registry.getProject(PROJECT_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored projects", () => {
    const registry = createInMemoryCoreRegistry();
    const created = registry.createProject(projectA);

    created.name = "Mutated";

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
    expect(registry.listProjects()).toEqual([projectA]);

    const fetched = registry.getProject(PROJECT_ID_A);
    if (!fetched) {
      throw new Error("Expected project to exist.");
    }
    fetched.name = "Fetched mutation";

    const listed = registry.listProjects()[0];
    if (!listed) {
      throw new Error("Expected project list item.");
    }
    listed.name = "Listed mutation";

    expect(registry.getProject(PROJECT_ID_A)).toEqual(projectA);
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
    expect(registry.listSessions(PROJECT_ID_A)).toEqual([sessionA, secondSession]);
  });

  it("returns null for a missing session", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getSession(MISSING_SESSION_ID)).toBeNull();
  });

  it("rejects duplicate session ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createSession(sessionA);

    expectRegistryError(() => registry.createSession(sessionA), "session_already_exists");
  });

  it("rejects sessions whose project does not exist", () => {
    const registry = createInMemoryCoreRegistry();

    expectRegistryError(() => registry.createSession(sessionA), "project_not_found");
  });

  it("rejects listing sessions for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    expectRegistryError(() => registry.listSessions(PROJECT_ID_A), "project_not_found");
  });

  it("validates sessions before storing them", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(() => registry.createSession({ ...sessionA, riskLevel: "extreme" } as never)).toThrow();
    expect(registry.getSession(SESSION_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored sessions", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    const created = registry.createSession(sessionA);

    created.title = "Mutated";

    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
    expect(registry.listSessions(PROJECT_ID_A)).toEqual([sessionA]);

    const fetched = registry.getSession(SESSION_ID_A);
    if (!fetched) {
      throw new Error("Expected session to exist.");
    }
    fetched.title = "Fetched mutation";

    const listed = registry.listSessions(PROJECT_ID_A)[0];
    if (!listed) {
      throw new Error("Expected session list item.");
    }
    listed.title = "Listed mutation";

    expect(registry.getSession(SESSION_ID_A)).toEqual(sessionA);
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
    expect(registry.listMemoryEntries(PROJECT_ID_A)).toEqual([projectMemory, sessionMemory]);
  });

  it("returns null for a missing memory entry", () => {
    const registry = createInMemoryCoreRegistry();

    expect(registry.getMemoryEntry(MISSING_MEMORY_ENTRY_ID)).toBeNull();
  });

  it("rejects duplicate memory entry ids", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createMemoryEntry(projectMemory);

    expectRegistryError(
      () => registry.createMemoryEntry(projectMemory),
      "memory_entry_already_exists",
    );
  });

  it("rejects memory entries whose project does not exist", () => {
    const registry = createInMemoryCoreRegistry();

    expectRegistryError(() => registry.createMemoryEntry(projectMemory), "project_not_found");
  });

  it("rejects session-scoped memory whose session does not exist", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expectRegistryError(() => registry.createMemoryEntry(sessionMemory), "session_not_found");
  });

  it("rejects session-scoped memory linked to a session in another project", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    registry.createProject(projectB);
    registry.createSession(sessionAInProjectB);

    expectRegistryError(
      () => registry.createMemoryEntry(sessionMemory),
      "session_project_mismatch",
    );
  });

  it("rejects listing memory entries for a missing project", () => {
    const registry = createInMemoryCoreRegistry();

    expectRegistryError(() => registry.listMemoryEntries(PROJECT_ID_A), "project_not_found");
  });

  it("validates memory entries before storing them", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);

    expect(() => registry.createMemoryEntry({ ...projectMemory, content: "   " })).toThrow();
    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toBeNull();
  });

  it("returns copies so callers cannot mutate stored memory entries", () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(projectA);
    const created = registry.createMemoryEntry(projectMemory);

    created.content = "Mutated";

    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
    expect(registry.listMemoryEntries(PROJECT_ID_A)).toEqual([projectMemory]);

    const fetched = registry.getMemoryEntry(MEMORY_ENTRY_ID_A);
    if (!fetched) {
      throw new Error("Expected memory entry to exist.");
    }
    fetched.content = "Fetched mutation";

    const listed = registry.listMemoryEntries(PROJECT_ID_A)[0];
    if (!listed) {
      throw new Error("Expected memory entry list item.");
    }
    listed.content = "Listed mutation";

    expect(registry.getMemoryEntry(MEMORY_ENTRY_ID_A)).toEqual(projectMemory);
  });
});
