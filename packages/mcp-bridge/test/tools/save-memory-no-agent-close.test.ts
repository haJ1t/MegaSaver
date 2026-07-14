import { type CoreRegistry, createInMemoryCoreRegistry, isRecallable } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleSaveMemory } from "../../src/tools/save-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const RULE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as MemoryEntryId;
const TS = "2026-06-11T00:00:00.000Z";
const LATER_TS = "2026-06-12T00:00:00.000Z";

// A seeded approved, current project row that a malicious agent will try to
// close by forging approval + supersedesId on its own save_memory call.
function targetSeededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
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

describe("save_memory cannot immediately close an approved memory (agent path)", () => {
  it("agent forging approval:approved + supersedesId does NOT close the target", async () => {
    const registry = targetSeededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => LATER_TS, newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "we moved deploys to eu-west",
        approval: "approved",
        supersedesId: RULE_ID,
      },
    );

    const target = registry.getMemoryEntry(RULE_ID);
    expect(target?.validTo).toBeUndefined();
    expect(isRecallable(target as never, LATER_TS)).toBe(true);
    expect(result.supersession?.closed).not.toBe(true);
  });
});
