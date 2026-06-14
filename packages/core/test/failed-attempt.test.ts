import { describe, expect, it } from "vitest";
import { type FailedAttempt, failedAttemptSchema } from "../src/failed-attempt.js";

const FA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKSPACE_KEY = "ws-abc123";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-11T00:00:00.000Z";

const valid = {
  id: FA_ID,
  workspaceKey: WORKSPACE_KEY,
  sessionId: SESSION_ID,
  task: "fix login bug",
  failedStep: "run auth tests",
  errorOutput: "Expected 200, got 401",
  relatedFiles: ["src/middleware/auth.ts"],
  suspectedCause: "expiry check uses < not <=",
  resolution: "use <=",
  convertedToRule: false,
  createdAt: TS,
};

describe("failedAttemptSchema", () => {
  it("parses a valid failed attempt", () => {
    const parsed: FailedAttempt = failedAttemptSchema.parse(valid);
    expect(parsed.failedStep).toBe("run auth tests");
    expect(parsed.convertedToRule).toBe(false);
  });

  it("allows a null sessionId", () => {
    expect(failedAttemptSchema.parse({ ...valid, sessionId: null }).sessionId).toBeNull();
  });

  it("defaults relatedFiles to [] and convertedToRule to false", () => {
    const { relatedFiles, convertedToRule, ...rest } = valid;
    const parsed = failedAttemptSchema.parse(rest);
    expect(parsed.relatedFiles).toEqual([]);
    expect(parsed.convertedToRule).toBe(false);
  });

  it("rejects an empty failedStep", () => {
    expect(() => failedAttemptSchema.parse({ ...valid, failedStep: "" })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => failedAttemptSchema.parse({ ...valid, extra: 1 })).toThrow();
  });
});
