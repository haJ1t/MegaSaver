import { createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { McpBridgeError } from "../src/errors.js";
import { handleApproveMemory } from "../src/tools/approve-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-12T00:00:00.000Z";

function seededRegistry() {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createMemoryEntry({
    id: MEMORY_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict mode",
    content: "strict mode enabled",
    keywords: [],
    confidence: "high",
    source: "agent",
    stale: false,
    approval: "suggested",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("handleApproveMemory", () => {
  it("approves a suggested memory and returns id + approval", async () => {
    const registry = seededRegistry();
    const result = await handleApproveMemory(
      { registry, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.id).toBe(MEMORY_ID);
    expect(result.approval).toBe("approved");
    const stored = registry.getMemoryEntry(MEMORY_ID as never);
    expect(stored?.approval).toBe("approved");
  });

  it("rejects a memory", async () => {
    const registry = seededRegistry();
    const result = await handleApproveMemory(
      { registry, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "rejected" },
    );
    expect(result.approval).toBe("rejected");
    expect(registry.getMemoryEntry(MEMORY_ID as never)?.approval).toBe("rejected");
  });

  it("defaults to approved when approval is omitted", async () => {
    const registry = seededRegistry();
    const result = await handleApproveMemory(
      { registry, now: () => TS },
      { memoryEntryId: MEMORY_ID },
    );
    expect(result.approval).toBe("approved");
  });

  it("throws resource_not_found for a missing id", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory(
        { registry, now: () => TS },
        { memoryEntryId: "99999999-9999-4999-8999-999999999999" },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("throws validation_failed for empty memoryEntryId", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: "" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("is idempotent — re-approving does not churn updatedAt", async () => {
    const registry = seededRegistry();
    const FIRST = "2026-06-12T01:00:00.000Z";
    await handleApproveMemory({ registry, now: () => FIRST }, { memoryEntryId: MEMORY_ID });
    const afterFirst = registry.getMemoryEntry(MEMORY_ID as never);
    expect(afterFirst?.approval).toBe("approved");
    expect(afterFirst?.updatedAt).toBe(FIRST);

    // No-op re-approve with a LATER clock must not advance updatedAt.
    const LATER = "2026-06-12T02:00:00.000Z";
    const result = await handleApproveMemory(
      { registry, now: () => LATER },
      { memoryEntryId: MEMORY_ID },
    );
    expect(result.approval).toBe("approved");
    expect(registry.getMemoryEntry(MEMORY_ID as never)?.updatedAt).toBe(FIRST);
  });

  it("throws validation_failed for unknown approval value", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory(
        { registry, now: () => TS },
        { memoryEntryId: MEMORY_ID, approval: "maybe" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects approval: suggested — cannot reverse a memory out of the gate", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory(
        { registry, now: () => TS },
        { memoryEntryId: MEMORY_ID, approval: "suggested" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects extra fields via strict schema", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: MEMORY_ID, extra: "oops" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

// Verify McpBridgeError is importable at test boundary
void McpBridgeError;
