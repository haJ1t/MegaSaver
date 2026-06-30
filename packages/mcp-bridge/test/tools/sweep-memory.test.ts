import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleSweepMemory } from "../../src/tools/sweep-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ID_OLD_LOW = "22222222-2222-4222-8222-222222222222";
const ID_RECENT_HIGH = "33333333-3333-4333-8333-333333333333";
const OLD = "2026-01-01T00:00:00.000Z";
const RECENT = "2026-06-29T00:00:00.000Z";
const NOW = "2026-06-30T00:00:00.000Z";

function add(
  registry: CoreRegistry,
  id: string,
  over: { confidence: "low" | "medium" | "high"; createdAt: string; updatedAt: string },
): void {
  registry.createMemoryEntry({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    content: id,
    type: "decision",
    title: id,
    keywords: [],
    confidence: over.confidence,
    source: "manual",
    approval: "approved",
    createdAt: over.createdAt,
    updatedAt: over.updatedAt,
  });
}

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: OLD,
    updatedAt: OLD,
  });
  add(registry, ID_OLD_LOW, { confidence: "low", createdAt: OLD, updatedAt: OLD });
  add(registry, ID_RECENT_HIGH, { confidence: "high", createdAt: RECENT, updatedAt: RECENT });
  return registry;
}

describe("handleSweepMemory", () => {
  it("archives the old low-confidence memory, leaves the recent high one, reports counts", async () => {
    const registry = seededRegistry();
    const result = await handleSweepMemory({ registry, now: NOW }, { projectId: PROJECT_ID });
    expect(result).toEqual({ archived: 1, scanned: 2 });

    // lossless + correct tier
    expect(registry.getMemoryEntry(ID_OLD_LOW)?.tier).toBe("archival");
    expect(registry.getMemoryEntry(ID_RECENT_HIGH)?.tier).toBeUndefined();
  });

  it("is idempotent — a second sweep archives nothing", async () => {
    const registry = seededRegistry();
    await handleSweepMemory({ registry, now: NOW }, { projectId: PROJECT_ID });
    const second = await handleSweepMemory({ registry, now: NOW }, { projectId: PROJECT_ID });
    expect(second).toEqual({ archived: 0, scanned: 2 });
  });

  it("rejects an unknown project", async () => {
    const registry = seededRegistry();
    await expect(
      handleSweepMemory(
        { registry, now: NOW },
        { projectId: "99999999-9999-4999-8999-999999999999" },
      ),
    ).rejects.toThrow();
  });
});
