import { describe, expect, it } from "vitest";
import { createInMemoryLongMemoryStore } from "../src/store.js";

const snapshot = {
  id: "33333333-3333-4333-8333-333333333333",
  workspaceKey: "workspace-a",
  sourceDigest: "b".repeat(64),
  kind: "state_snapshot" as const,
  observedAt: "2026-07-20T00:00:00.000Z",
  text: "Billing status is paid.",
  evidenceIds: ["evidence-1"],
};

describe("in-memory long memory store", () => {
  it("deduplicates an observation by source digest within its workspace", () => {
    const store = createInMemoryLongMemoryStore();
    expect(store.insert(snapshot)).toEqual({ inserted: true });
    expect(store.insert({ ...snapshot, id: "44444444-4444-4444-8444-444444444444" })).toEqual({
      inserted: false,
    });
  });

  it("recalls a matching workspace observation inside its token budget", () => {
    const store = createInMemoryLongMemoryStore();
    store.insert(snapshot);
    expect(
      store.query({ task: "What is the billing status?", workspaceKey: "workspace-a", tokenBudget: 20 }),
    ).toMatchObject({
      items: [{ type: "text", value: "Billing status is paid.", observationId: snapshot.id }],
      receipt: [{ observationId: snapshot.id, evidenceIds: snapshot.evidenceIds, lane: "state" }],
    });
  });
});
