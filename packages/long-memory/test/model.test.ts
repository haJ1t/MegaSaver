import { describe, expect, it } from "vitest";
import { observationSchema, recallRequestSchema } from "../src/model.js";

const observation = {
  id: "22222222-2222-4222-8222-222222222222",
  workspaceKey: "workspace-a",
  sourceDigest: "a".repeat(64),
  kind: "state_snapshot",
  observedAt: "2026-07-20T00:00:00.000Z",
  text: "Billing status is paid.",
  evidenceIds: ["evidence-1"],
} as const;

describe("long memory model", () => {
  it("accepts a cited state snapshot", () => {
    expect(observationSchema.parse(observation).kind).toBe("state_snapshot");
  });

  it("rejects an unknown observation field", () => {
    expect(() => observationSchema.parse({ ...observation, extra: true })).toThrow();
  });

  it("rejects a recall request without a positive token budget", () => {
    expect(() =>
      recallRequestSchema.parse({ task: "Recall billing state", workspaceKey: "workspace-a", tokenBudget: 0 }),
    ).toThrow();
  });
});
