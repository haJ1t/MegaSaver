import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleGetRelevantMemories } from "../src/tools/get-relevant-memories.js";
import { handleGetProjectContext } from "../src/tools/project-context.js";
import { handleRecall } from "../src/tools/recall.js";
import { handleSearchMemory } from "../src/tools/search-memory.js";

const PROJECT_ID = "55555555-5555-4555-8555-555555555555" as ProjectId;
const SESSION_ID = "66666666-6666-4666-8666-666666666666" as SessionId;
const TS = "2026-06-17T00:00:00.000Z";
const APPROVED_ID = "aaaa0000-0000-4000-8000-000000000001" as MemoryEntryId;
const SUGGESTED_ID = "bbbb0000-0000-4000-8000-000000000002" as MemoryEntryId;
const REJECTED_ID = "cccc0000-0000-4000-8000-000000000003" as MemoryEntryId;

function seededLeakRegistry() {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "leak-test",
    rootPath: "/tmp/leak-test",
    createdAt: TS,
    updatedAt: TS,
  });
  // A session so mega_recall can resolve the project from the sessionId. The
  // ALPHA/BRAVO/CHARLIE memories are project-scoped, so recall's
  // (sessionId === session.id || scope === "project") filter admits them by scope.
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "leak-test session",
    startedAt: TS,
    endedAt: null,
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

  it("mega_recall excludes suggested + rejected", async () => {
    const registry = seededLeakRegistry();
    const { memory } = await handleRecall(
      { registry, storeRoot: "/tmp/does-not-exist-store" },
      { sessionId: SESSION_ID, intent: "build tooling" },
    );
    const contents = memory.map((m) => m.content);
    expect(contents).toContain("ALPHA");
    expect(contents).not.toContain("BRAVO");
    expect(contents).not.toContain("CHARLIE");
  });

  it("get_project_context excludes suggested + rejected from keyMemories", async () => {
    const registry = seededLeakRegistry();
    const { keyMemories } = await handleGetProjectContext(
      { registry, storeRoot: "/tmp/does-not-exist-store" },
      { projectId: PROJECT_ID },
    );
    const contents = keyMemories.map((m) => m.content);
    expect(contents).toContain("ALPHA");
    expect(contents).not.toContain("BRAVO");
    expect(contents).not.toContain("CHARLIE");
  });
});
