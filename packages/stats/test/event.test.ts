import { describe, expect, it } from "vitest";
import {
  deltaTokensOf,
  overlayTokenSaverEventSchema,
  tokenSaverEventSchema,
} from "../src/event.js";

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

describe("measured token fields", () => {
  const base = {
    id: "ove-1",
    liveSessionId: "sess-1",
    workspaceKey: "wsk-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceKind: "file" as const,
    label: "read",
    rawBytes: 4000,
    returnedBytes: 1000,
    bytesSaved: 3000,
    deltaBytes: 3000,
    savingRatio: 0.75,
    summary: "s",
  };

  it("parses a pre-measurement row that carries no token fields", () => {
    const parsed = overlayTokenSaverEventSchema.parse(base);
    expect(deltaTokensOf(parsed)).toBeUndefined();
  });

  it("keeps a negative deltaTokens — inflation must stay visible", () => {
    const parsed = overlayTokenSaverEventSchema.parse({
      ...base,
      rawTokens: 900,
      returnedTokens: 1300,
      deltaTokens: -400,
    });
    expect(parsed.deltaTokens).toBe(-400);
    expect(deltaTokensOf(parsed)).toBe(-400);
  });

  it("rejects a negative rawTokens — a count cannot be below zero", () => {
    expect(() => overlayTokenSaverEventSchema.parse({ ...base, rawTokens: -1 })).toThrow();
  });

  it("never derives deltaTokens from bytes when the field is absent", () => {
    const parsed = overlayTokenSaverEventSchema.parse({ ...base, rawTokens: 900 });
    expect(deltaTokensOf(parsed)).toBeUndefined();
  });
});

describe("overlayTokenSaverEventSchema origin (exec-rewrite)", () => {
  const base = {
    id: "ove-2",
    liveSessionId: "sess-2",
    workspaceKey: "wsk-2",
    createdAt: "2026-08-13T00:00:00.000Z",
    sourceKind: "file" as const,
    label: "read",
    rawBytes: 4000,
    returnedBytes: 1000,
    bytesSaved: 3000,
    deltaBytes: 3000,
    savingRatio: 0.75,
    summary: "s",
  };

  it("accepts origin: exec-rewrite", () => {
    const r = overlayTokenSaverEventSchema.safeParse({ ...base, origin: "exec-rewrite" });
    expect(r.success).toBe(true);
  });

  it("rejects unknown origin values", () => {
    const r = overlayTokenSaverEventSchema.safeParse({ ...base, origin: "post-tool-use" });
    expect(r.success).toBe(false);
  });

  it("still parses pre-wave-2 rows without origin", () => {
    expect(overlayTokenSaverEventSchema.safeParse(base).success).toBe(true);
  });
});
