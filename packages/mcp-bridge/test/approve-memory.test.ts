import { createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { McpBridgeError } from "../src/errors.js";
import { handleApproveMemory } from "../src/tools/approve-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID = "22222222-2222-4222-8222-222222222222";
const APPROVED_ID = "33333333-3333-4333-8333-333333333333";
const DUP_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-06-12T00:00:00.000Z";

function seededRegistry(over: { source?: "agent" | "manual"; evidenceIds?: string[]; confidence?: "low" | "medium" | "high" } = {}) {
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
    confidence: over.confidence ?? "high",
    source: over.source ?? "agent",
    stale: false,
    approval: "suggested",
    ...(over.evidenceIds !== undefined ? { evidence: over.evidenceIds } : {}),
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function seededDuplicateRegistry() {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  // An already-approved memory.
  registry.createMemoryEntry({
    id: APPROVED_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict mode",
    content: "strict mode enabled",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "approved",
    createdAt: TS,
    updatedAt: TS,
  });
  // A suggested duplicate with identical title+content.
  registry.createMemoryEntry({
    id: DUP_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict mode",
    content: "strict mode enabled",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "suggested",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("handleApproveMemory", () => {
  it("approves a suggested memory and returns id + approval", async () => {
    const registry = seededRegistry({ source: "manual", confidence: "medium" });
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
    const registry = seededRegistry({ source: "manual", confidence: "medium" });
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
    const registry = seededRegistry({ source: "manual", confidence: "medium" });
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

describe("approve_memory validation gate (adversarial)", () => {
  it("refuses to approve an agent memory with no evidence (stays suggested, returns reasons)", async () => {
    const registry = seededRegistry(); // seeds a suggested agent memory with no evidence
    const result = await handleApproveMemory(
      { registry, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested"); // NOT approved
    expect(result.validation?.status).toBe("quarantined");
    expect(result.validation?.reasons).toContain("missing_evidence");
    expect(registry.getMemoryEntry(MEMORY_ID as never)?.approval).toBe("suggested");
  });

  it("approves a human-curated memory with no conflicts", async () => {
    const registry = seededRegistry({ source: "manual", confidence: "medium", evidenceIds: [] });
    const result = await handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: MEMORY_ID, approval: "approved" });
    expect(result.approval).toBe("approved");
  });

  it("a reject decision still rejects regardless of validation", async () => {
    const registry = seededRegistry();
    const result = await handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: MEMORY_ID, approval: "rejected" });
    expect(result.approval).toBe("rejected");
  });

  it("approving an exact duplicate of an approved memory REJECTS it (no second approved row) — spec §8", async () => {
    // Seed an already-approved memory + a suggested duplicate with the same title+content.
    const registry = seededDuplicateRegistry();
    const before = registry.listMemoryEntries(PROJECT_ID).filter((m) => m.approval === "approved").length;
    const result = await handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: DUP_ID, approval: "approved" });
    expect(result.approval).toBe("rejected");
    expect(result.conflict?.outcome).toBe("duplicate");
    const after = registry.listMemoryEntries(PROJECT_ID).filter((m) => m.approval === "approved").length;
    expect(after).toBe(before); // duplicate did NOT create a second approved row
  });
});

// Verify McpBridgeError is importable at test boundary
void McpBridgeError;
