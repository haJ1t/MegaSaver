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
