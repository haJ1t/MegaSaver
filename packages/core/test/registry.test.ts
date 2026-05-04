import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
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
