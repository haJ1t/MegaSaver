import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type Session, sessionSchema } from "../src/session.js";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STARTED_AT = "2026-05-04T12:10:00.000Z";
const ENDED_AT = "2026-05-04T12:20:00.000Z";

const validSession = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  agentId: "claude-code",
  riskLevel: "high",
  title: "Implement core foundation",
  startedAt: STARTED_AT,
  endedAt: null,
};

describe("sessionSchema", () => {
  it("parses a valid active session", () => {
    expect(sessionSchema.parse(validSession)).toEqual(validSession);
  });

  it("parses a completed session", () => {
    expect(sessionSchema.parse({ ...validSession, endedAt: ENDED_AT })).toEqual({
      ...validSession,
      endedAt: ENDED_AT,
    });
  });

  it("allows a null title", () => {
    expect(sessionSchema.parse({ ...validSession, title: null }).title).toBe(null);
  });

  it("trims non-null titles", () => {
    expect(sessionSchema.parse({ ...validSession, title: "  Core work  " }).title).toBe(
      "Core work",
    );
  });

  it("rejects empty titles after trimming", () => {
    const result = sessionSchema.safeParse({ ...validSession, title: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("rejects invalid ids, agent ids, risk levels, and datetimes", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      id: "not-a-uuid",
      projectId: "not-a-uuid",
      agentId: "not-an-agent",
      riskLevel: "extreme",
      startedAt: "now",
      endedAt: "later",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "id",
        "projectId",
        "agentId",
        "riskLevel",
        "startedAt",
        "endedAt",
      ]);
    }
  });

  it("rejects unknown fields", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      agentConfigPath: "/tmp/AGENTS.md",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("property: any shipped v0.1 agent id is accepted", () => {
    fc.assert(
      fc.property(fc.constantFrom("claude-code", "codex", "generic-cli"), (agentId) => {
        expect(sessionSchema.safeParse({ ...validSession, agentId }).success).toBe(true);
      }),
    );
  });

  it("exports the inferred Session type", () => {
    expectTypeOf<Session>().toMatchTypeOf<{
      id: string;
      projectId: string;
      agentId: "claude-code" | "codex" | "generic-cli";
      riskLevel: "low" | "medium" | "high" | "critical";
      title: string | null;
      startedAt: string;
      endedAt: string | null;
    }>();
  });
});
