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
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createMemoryEntry({
    id: "a0000000-0000-4000-8000-000000000002",
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Pending suggestion",
    content: "Agent suggested this, not yet approved.",
    keywords: [],
    confidence: "high",
    source: "agent",
    approval: "suggested",
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

  it("excludes suggested key memories — only approved appear in keyMemories", async () => {
    const res = await handleGetProjectContext(
      { registry: seeded(), storeRoot: "/tmp/does-not-exist-store" },
      { projectId: PROJECT_ID },
    );
    const titles = res.keyMemories.map((m) => m.title);
    expect(titles).toContain("Auth uses JWT");
    expect(titles).not.toContain("Pending suggestion");
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
