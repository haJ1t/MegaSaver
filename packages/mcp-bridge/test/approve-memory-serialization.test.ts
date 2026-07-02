import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleApproveMemory } from "../src/tools/approve-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as MemoryEntryId;
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as MemoryEntryId;
const TS1 = "2026-06-17T10:00:00.000Z";
const TS2 = "2026-06-17T10:01:00.000Z";

function buildRegistry() {
  const r = createInMemoryCoreRegistry();
  r.createProject({
    id: PROJECT_ID,
    name: "p",
    rootPath: "/tmp/p",
    createdAt: TS1,
    updatedAt: TS1,
  });
  // A: suggested, manual/medium, relatedFiles: ["src/foo.ts"], type: "decision"
  r.createMemoryEntry({
    id: A_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use ESM",
    content: "use esm modules",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "suggested",
    relatedFiles: ["src/foo.ts"],
    createdAt: TS1,
    updatedAt: TS1,
  });
  // B: suggested, manual/medium, same relatedFiles + type but DIFFERENT conclusion → supersession
  r.createMemoryEntry({
    id: B_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use CJS",
    content: "use cjs modules",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "suggested",
    relatedFiles: ["src/foo.ts"],
    createdAt: TS1,
    updatedAt: TS1,
  });
  return r;
}

describe("approval serialization — spec §8", () => {
  it("approving A then B (supersession of A) leaves B as suggested", async () => {
    const registry = buildRegistry();
    // Step 1: approve A — must succeed (no conflicts yet, A is the first approved).
    const resA = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS1 },
      { memoryEntryId: A_ID },
    );
    expect(resA.approval).toBe("approved");
    expect(registry.getMemoryEntry(A_ID as never)?.approval).toBe("approved");

    // Step 2: approve B — B conflicts with now-approved A (same file+type, different content).
    // The re-read inside handleApproveMemory must see A as approved and catch supersession.
    const resB = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS2 },
      { memoryEntryId: B_ID },
    );
    expect(resB.approval).toBe("suggested"); // NOT approved
    expect(resB.conflict?.outcome).toBe("supersession");
    expect(resB.conflict?.conflictIds).toContain(A_ID);
    // B must still be "suggested" in the store — the flip must NOT have happened.
    expect(registry.getMemoryEntry(B_ID as never)?.approval).toBe("suggested");
  });

  it("B approved first; then A (supersession of B) stays suggested", async () => {
    const registry = buildRegistry();
    const resB = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS1 },
      { memoryEntryId: B_ID },
    );
    expect(resB.approval).toBe("approved");

    const resA = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS2 },
      { memoryEntryId: A_ID },
    );
    expect(resA.approval).toBe("suggested");
    expect(resA.conflict?.outcome).toBe("supersession");
    expect(registry.getMemoryEntry(A_ID as never)?.approval).toBe("suggested");
  });

  it("conflict check re-reads approved set at call time — no stale cache", async () => {
    // If the conflict check used a snapshot captured before A was approved, it would miss A.
    // This test proves it does NOT: approve A, then immediately check B sees A.
    const registry = buildRegistry();
    await handleApproveMemory({ registry, storeRoot: "", now: () => TS1 }, { memoryEntryId: A_ID });
    // Do NOT await anything else between A approval and B check.
    const resB = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS2 },
      { memoryEntryId: B_ID },
    );
    // Key assertion: conflict detected, not "unrelated".
    expect(resB.conflict?.outcome).not.toBe("unrelated");
    expect(resB.approval).toBe("suggested");
  });

  it("approving non-conflicting memories in sequence both succeed", async () => {
    // Control: two unrelated memories (different files) must both approve fine.
    const registry = createInMemoryCoreRegistry();
    const P = "22222222-2222-4222-8222-222222222222" as ProjectId;
    const X_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as MemoryEntryId;
    const Y_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as MemoryEntryId;
    registry.createProject({
      id: P,
      name: "q",
      rootPath: "/tmp/q",
      createdAt: TS1,
      updatedAt: TS1,
    });
    registry.createMemoryEntry({
      id: X_ID,
      projectId: P,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Use ESM",
      content: "use esm",
      keywords: [],
      confidence: "medium",
      source: "manual",
      stale: false,
      approval: "suggested",
      relatedFiles: ["src/x.ts"],
      createdAt: TS1,
      updatedAt: TS1,
    });
    registry.createMemoryEntry({
      id: Y_ID,
      projectId: P,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Use lint",
      content: "use biome",
      keywords: [],
      confidence: "medium",
      source: "manual",
      stale: false,
      approval: "suggested",
      relatedFiles: ["src/y.ts"],
      createdAt: TS1,
      updatedAt: TS1,
    });
    const rx = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS1 },
      { memoryEntryId: X_ID },
    );
    expect(rx.approval).toBe("approved");
    const ry = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS2 },
      { memoryEntryId: Y_ID },
    );
    expect(ry.approval).toBe("approved");
  });
});
