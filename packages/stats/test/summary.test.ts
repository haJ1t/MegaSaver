import { describe, expect, it } from "vitest";
import { sessionTokenSaverStatsSchema } from "../src/summary.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const validSummary = {
  sessionId: SESSION_ID,
  eventsTotal: 2,
  rawBytesTotal: 2000,
  returnedBytesTotal: 400,
  bytesSavedTotal: 1600,
  savingRatio: 0.8,
  secretsRedactedTotal: 3,
  chunksStoredTotal: 5,
  updatedAt: "2026-05-10T12:00:00.000Z",
};

describe("sessionTokenSaverStatsSchema", () => {
  it("accepts a valid summary", () => {
    expect(sessionTokenSaverStatsSchema.parse(validSummary).eventsTotal).toBe(2);
  });

  it("rejects unknown keys (strict)", () => {
    expect(sessionTokenSaverStatsSchema.safeParse({ ...validSummary, extra: 1 }).success).toBe(
      false,
    );
  });

  it("rejects a non-UUID sessionId", () => {
    expect(
      sessionTokenSaverStatsSchema.safeParse({ ...validSummary, sessionId: "x" }).success,
    ).toBe(false);
  });

  it("rejects an out-of-range savingRatio", () => {
    expect(
      sessionTokenSaverStatsSchema.safeParse({ ...validSummary, savingRatio: -0.1 }).success,
    ).toBe(false);
  });

  it("rejects a negative total", () => {
    expect(
      sessionTokenSaverStatsSchema.safeParse({ ...validSummary, eventsTotal: -1 }).success,
    ).toBe(false);
  });

  it("rejects an updatedAt without offset", () => {
    expect(
      sessionTokenSaverStatsSchema.safeParse({ ...validSummary, updatedAt: "not-a-date" }).success,
    ).toBe(false);
  });
});
