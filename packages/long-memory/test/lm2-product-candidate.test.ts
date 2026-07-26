import { describe, expect, it } from "vitest";
import * as longMemory from "../src/index.js";

const candidate = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceKey: "0123456789abcdef",
  observedAt: "2026-07-26T00:00:00.000Z",
  kind: "memory_entry",
  text: "Rotate deployment credentials before release.",
  sourceDigest: "a".repeat(64),
};

describe("LM2 product-memory candidate contract", () => {
  it("admits a memory entry without changing benchmark kinds", () => {
    expect(longMemory.lm2CandidateSchema.safeParse(candidate).success).toBe(true);
    expect(
      longMemory.lm2CandidateSchema.safeParse({ ...candidate, kind: "state_snapshot" }).success,
    ).toBe(true);
    expect(longMemory.lm2CandidateSchema.safeParse({ ...candidate, kind: "unknown" }).success).toBe(
      false,
    );
  });

  it("exports the generic LM2 ranker for product adapters", () => {
    const api = longMemory as unknown as { rankLm2Candidates?: unknown };
    expect(api.rankLm2Candidates).toBeTypeOf("function");
  });

  it("derives a canonical embedding identity for product memory", () => {
    expect(() =>
      longMemory.embeddingInputDigest({
        kind: "memory_entry",
        text: candidate.text,
      }),
    ).not.toThrow();
  });
});
