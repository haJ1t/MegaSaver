import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleGetRelevantMemories } from "../../src/tools/get-relevant-memories.js";
import { handleSaveMemory } from "../../src/tools/save-memory.js";
import { handleSearchMemory } from "../../src/tools/search-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
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

function idFactory(): () => string {
  const ids = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ];
  let i = 0;
  return () => ids[i++] ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
}

describe("memory MCP tools", () => {
  it("save_memory creates a typed entry and returns its id", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "use JWT middleware",
        type: "decision",
        title: "JWT auth",
        keywords: ["auth"],
      },
    );
    expect(result.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const stored = registry.getMemoryEntry(result.id as never);
    expect(stored?.type).toBe("decision");
    expect(stored?.source).toBe("agent");
  });

  it("save_memory rejects an unknown project as resource_not_found", async () => {
    const registry = seededRegistry();
    await expect(
      handleSaveMemory(
        { registry, now: () => TS, newId: idFactory() },
        {
          projectId: "99999999-9999-4999-8999-999999999999",
          scope: "project",
          content: "orphan",
        },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("save_memory rejects invalid input as validation_failed", async () => {
    const registry = seededRegistry();
    await expect(
      handleSaveMemory(
        { registry, now: () => TS, newId: idFactory() },
        { projectId: PROJECT_ID, scope: "project", content: "x", type: "bogus" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("save_memory rejects an invalid expiresAt at the input boundary", async () => {
    const registry = seededRegistry();
    await expect(
      handleSaveMemory(
        { registry, now: () => TS, newId: idFactory() },
        { projectId: PROJECT_ID, scope: "project", content: "x", expiresAt: "tomorrow" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("search_memory ranks by text and get_relevant_memories returns hits", async () => {
    const registry = seededRegistry();
    const newId = idFactory();
    await handleSaveMemory(
      { registry, now: () => TS, newId },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "JWT auth middleware",
        keywords: ["auth"],
        approval: "approved",
      },
    );
    await handleSaveMemory(
      { registry, now: () => TS, newId },
      { projectId: PROJECT_ID, scope: "project", content: "navbar styling", approval: "approved" },
    );

    const search = await handleSearchMemory({ registry }, { projectId: PROJECT_ID, text: "auth" });
    expect(search.memory[0]?.content).toBe("JWT auth middleware");
    expect(search.memory.map((m) => m.content)).not.toContain("navbar styling");

    const relevant = await handleGetRelevantMemories(
      { registry },
      { projectId: PROJECT_ID, task: "fix the auth flow" },
    );
    expect(relevant.memory[0]?.content).toBe("JWT auth middleware");
  });

  it("search_memory rejects an unknown project as resource_not_found", async () => {
    const registry = seededRegistry();
    await expect(
      handleSearchMemory(
        { registry },
        { projectId: "99999999-9999-4999-8999-999999999999", text: "x" },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("save_memory without approval defaults to suggested", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "agent observation" },
    );
    const stored = registry.getMemoryEntry(result.id as never);
    expect(stored?.approval).toBe("suggested");
  });

  it("save_memory with explicit approval honours it", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "human curated", approval: "approved" },
    );
    const stored = registry.getMemoryEntry(result.id as never);
    expect(stored?.approval).toBe("approved");
  });
});

const RULE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as MemoryEntryId;
const LATER_TS = "2026-06-12T00:00:00.000Z";

// An approved project_rule the candidates below collide with. Contradiction
// fixture shape (core conflict-checker): same type + relatedFiles overlap +
// SAME normalized content (so the higher-precedence supersession class cannot
// shadow contradiction) + negation-keyword XOR ("never" on the candidate only).
function ruleSeededRegistry(): CoreRegistry {
  const registry = seededRegistry();
  registry.createMemoryEntry({
    id: RULE_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "project_rule",
    title: "Deploy region rule",
    content: "deploy to us-east",
    keywords: ["deploy"],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "approved",
    relatedFiles: ["src/deploy.ts"],
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("save_memory supersession lineage (living brain)", () => {
  it("links a detected contradiction on a suggested write (no close) and reports it", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        type: "project_rule",
        title: "Never deploy region rule",
        content: "deploy to us-east",
        keywords: ["never"],
        relatedFiles: ["src/deploy.ts"],
      },
    );
    expect(result.supersession).toEqual({
      supersededId: RULE_ID,
      via: "contradiction",
      closed: false,
    });
    const stored = registry.getMemoryEntry(result.id as never);
    expect(stored?.supersedesId).toBe(RULE_ID);
    expect(registry.getMemoryEntry(RULE_ID as never)?.validTo).toBeUndefined();
  });

  it("closes the contradicted rule when the write is born approved (closed: true)", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        type: "project_rule",
        title: "Never deploy region rule",
        content: "deploy to us-east",
        keywords: ["never"],
        relatedFiles: ["src/deploy.ts"],
        approval: "approved",
      },
    );
    expect(result.supersession).toEqual({
      supersededId: RULE_ID,
      via: "contradiction",
      closed: true,
    });
    expect(registry.getMemoryEntry(RULE_ID as never)?.validTo).toBe(LATER_TS);
  });

  it("dedupes an exact duplicate of an approved memory (no write, existing id returned)", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        type: "project_rule",
        title: "Deploy region rule",
        content: "deploy to us-east",
      },
    );
    expect(result.id).toBe(RULE_ID);
    expect(result.deduped).toEqual({ existingId: RULE_ID });
    expect(result.supersession).toBeUndefined();
    expect(registry.listMemoryEntries(PROJECT_ID)).toHaveLength(1);
  });

  it("explicit supersedesId passthrough is unchanged (suggested: stored link, no close)", async () => {
    const registry = ruleSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "we moved deploys to eu-west",
        supersedesId: RULE_ID,
      },
    );
    const stored = registry.getMemoryEntry(result.id as never);
    expect(stored?.supersedesId).toBe(RULE_ID);
    expect(registry.getMemoryEntry(RULE_ID as never)?.validTo).toBeUndefined();
  });
});
