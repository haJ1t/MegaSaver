import { describe, expect, it } from "vitest";
import {
  MAX_EVIDENCE_IDS,
  MAX_EVIDENCE_ID_LENGTH,
  MAX_OBSERVATION_TEXT_CHARS,
  MAX_RECALL_TASK_CHARS,
  MAX_RECALL_TOKEN_BUDGET,
  MAX_WORKSPACE_KEY_LENGTH,
  observationSchema,
  recallRequestSchema,
} from "../src/model.js";

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
      recallRequestSchema.parse({
        task: "Recall billing state",
        workspaceKey: "workspace-a",
        tokenBudget: 0,
      }),
    ).toThrow();
  });

  it("bounds observations and recall requests at the public boundary", () => {
    expect(MAX_OBSERVATION_TEXT_CHARS).toBeGreaterThan(0);
    expect(MAX_WORKSPACE_KEY_LENGTH).toBeGreaterThan(0);
    expect(MAX_EVIDENCE_ID_LENGTH).toBeGreaterThan(0);
    expect(MAX_EVIDENCE_IDS).toBeGreaterThan(0);
    expect(MAX_RECALL_TASK_CHARS).toBeGreaterThan(0);
    expect(MAX_RECALL_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(() =>
      observationSchema.parse({
        ...observation,
        text: "x".repeat(MAX_OBSERVATION_TEXT_CHARS + 1),
      }),
    ).toThrow();
    expect(() =>
      observationSchema.parse({
        ...observation,
        workspaceKey: "x".repeat(MAX_WORKSPACE_KEY_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      observationSchema.parse({
        ...observation,
        evidenceIds: ["x".repeat(MAX_EVIDENCE_ID_LENGTH + 1)],
      }),
    ).toThrow();
    expect(() =>
      observationSchema.parse({
        ...observation,
        evidenceIds: Array.from({ length: MAX_EVIDENCE_IDS + 1 }, () => "evidence"),
      }),
    ).toThrow();
    expect(() =>
      recallRequestSchema.parse({
        task: "x".repeat(MAX_RECALL_TASK_CHARS + 1),
        workspaceKey: "workspace-a",
        tokenBudget: MAX_RECALL_TOKEN_BUDGET + 1,
      }),
    ).toThrow();
  });
});
