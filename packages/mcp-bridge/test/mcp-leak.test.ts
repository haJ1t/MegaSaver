import { createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleGetRelevantMemories } from "../src/tools/get-relevant-memories.js";
import { handleSearchMemory } from "../src/tools/search-memory.js";

const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const TS = "2026-06-17T00:00:00.000Z";
const APPROVED_ID = "aaaa0000-0000-4000-8000-000000000001";
const SUGGESTED_ID = "bbbb0000-0000-4000-8000-000000000002";
const REJECTED_ID = "cccc0000-0000-4000-8000-000000000003";

function seededLeakRegistry() {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "leak-test",
    rootPath: "/tmp/leak-test",
    createdAt: TS,
    updatedAt: TS,
  });
  // ALPHA — approved, should appear in retrieval.
  registry.createMemoryEntry({
    id: APPROVED_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "shared fact ALPHA",
    content: "ALPHA",
    keywords: ["shared"],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "approved",
    createdAt: TS,
    updatedAt: TS,
  });
  // BRAVO — suggested (not yet approved), must NOT appear.
  registry.createMemoryEntry({
    id: SUGGESTED_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "shared fact BRAVO",
    content: "BRAVO",
    keywords: ["shared"],
    confidence: "medium",
    source: "agent",
    stale: false,
    approval: "suggested",
    createdAt: TS,
    updatedAt: TS,
  });
  // CHARLIE — rejected, must NOT appear.
  registry.createMemoryEntry({
    id: REJECTED_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "shared fact CHARLIE",
    content: "CHARLIE",
    keywords: ["shared"],
    confidence: "medium",
    source: "agent",
    stale: false,
    approval: "rejected",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("MCP leak invariant: agent retrieval returns approved-only", () => {
  it("search_memory excludes suggested + rejected", async () => {
    const registry = seededLeakRegistry();
    const { memory } = await handleSearchMemory(
      { registry },
      { projectId: PROJECT_ID, text: "shared" },
    );
    const contents = memory.map((m) => m.content);
    expect(contents).toContain("ALPHA");
    expect(contents).not.toContain("BRAVO");
    expect(contents).not.toContain("CHARLIE");
  });

  it("get_relevant_memories excludes suggested + rejected", async () => {
    const registry = seededLeakRegistry();
    const { memory } = await handleGetRelevantMemories(
      { registry },
      { projectId: PROJECT_ID, task: "shared" },
    );
    const contents = memory.map((m) => m.content);
    expect(contents).toContain("ALPHA");
    expect(contents).not.toContain("BRAVO");
    expect(contents).not.toContain("CHARLIE");
  });
});
