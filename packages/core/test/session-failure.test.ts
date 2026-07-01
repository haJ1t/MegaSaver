import { describe, expect, it } from "vitest";
import { type SessionFailure, sessionFailureSchema } from "../src/session-failure.js";

const valid = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  command: "pnpm test",
  errorOutput: "Expected 200, got 401",
  source: "proxy-classifier",
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("sessionFailureSchema", () => {
  it("parses a valid session failure", () => {
    const parsed: SessionFailure = sessionFailureSchema.parse(valid);
    expect(parsed.command).toBe("pnpm test");
    expect(parsed.source).toBe("proxy-classifier");
  });

  it("rejects an empty command", () => {
    expect(() => sessionFailureSchema.parse({ ...valid, command: "" })).toThrow();
  });
});
