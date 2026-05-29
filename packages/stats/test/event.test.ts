import { describe, expect, it } from "vitest";
import { tokenSaverEventSchema } from "../src/event.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const validEvent = {
  id: "evt-1",
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  createdAt: "2026-05-10T12:00:00.000Z",
  sourceKind: "file",
  label: "read login.ts",
  rawBytes: 1000,
  returnedBytes: 200,
  bytesSaved: 800,
  savingRatio: 0.8,
  summary: "filtered output",
  mode: "balanced",
};

describe("tokenSaverEventSchema", () => {
  it("accepts a valid event", () => {
    expect(tokenSaverEventSchema.parse(validEvent)).toMatchObject({ id: "evt-1" });
  });

  it("accepts an optional chunkSetId", () => {
    const r = tokenSaverEventSchema.safeParse({ ...validEvent, chunkSetId: "cs-1" });
    expect(r.success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    const r = tokenSaverEventSchema.safeParse({ ...validEvent, extra: true });
    expect(r.success).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(tokenSaverEventSchema.safeParse({ ...validEvent, id: "" }).success).toBe(false);
  });

  it("rejects a non-UUID sessionId", () => {
    expect(tokenSaverEventSchema.safeParse({ ...validEvent, sessionId: "nope" }).success).toBe(
      false,
    );
  });

  it("rejects a createdAt without offset", () => {
    expect(
      tokenSaverEventSchema.safeParse({ ...validEvent, createdAt: "2026-05-10 12:00" }).success,
    ).toBe(false);
  });

  it("rejects an out-of-range savingRatio", () => {
    expect(tokenSaverEventSchema.safeParse({ ...validEvent, savingRatio: 1.5 }).success).toBe(
      false,
    );
  });

  it("rejects a negative rawBytes", () => {
    expect(tokenSaverEventSchema.safeParse({ ...validEvent, rawBytes: -1 }).success).toBe(false);
  });

  it("rejects a non-integer returnedBytes", () => {
    expect(tokenSaverEventSchema.safeParse({ ...validEvent, returnedBytes: 1.5 }).success).toBe(
      false,
    );
  });

  it("rejects an unknown sourceKind", () => {
    expect(tokenSaverEventSchema.safeParse({ ...validEvent, sourceKind: "socket" }).success).toBe(
      false,
    );
  });

  it("rejects an empty chunkSetId when present", () => {
    expect(tokenSaverEventSchema.safeParse({ ...validEvent, chunkSetId: "" }).success).toBe(false);
  });
});
