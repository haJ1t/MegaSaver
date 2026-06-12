import { describe, expect, it } from "vitest";
import { auditEventSchema } from "../src/audit-event.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const base = {
  id: "evt-1",
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  createdAt: "2026-06-12T12:00:00.000Z",
};

describe("auditEventSchema", () => {
  it("parses a context_pack_built event", () => {
    const e = auditEventSchema.parse({
      ...base,
      kind: "context_pack_built",
      filesConsidered: 5,
      filesIncluded: 2,
      filesExcluded: 3,
      blocksConsidered: 8,
      blocksIncluded: 3,
      blocksExcluded: 5,
      tokensBefore: 7000,
      tokensAfter: 2300,
    });
    expect(e.kind).toBe("context_pack_built");
  });

  it("parses rule_applied, memory_retrieved, failure_avoided, tool_route", () => {
    expect(auditEventSchema.parse({ ...base, kind: "rule_applied" }).kind).toBe("rule_applied");
    expect(auditEventSchema.parse({ ...base, kind: "memory_retrieved" }).kind).toBe(
      "memory_retrieved",
    );
    expect(
      auditEventSchema.parse({ ...base, kind: "failure_avoided", retryTokensAvoided: 1200 }).kind,
    ).toBe("failure_avoided");
    expect(
      auditEventSchema.parse({
        ...base,
        kind: "tool_route",
        toolsConsidered: 10,
        toolsAllowed: 3,
        toolSchemasReduced: 7,
      }).kind,
    ).toBe("tool_route");
  });

  it("rejects an unknown kind", () => {
    expect(auditEventSchema.safeParse({ ...base, kind: "nope" }).success).toBe(false);
  });

  it("rejects an unknown key (strict)", () => {
    expect(
      auditEventSchema.safeParse({ ...base, kind: "rule_applied", extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects a negative pack integer", () => {
    expect(
      auditEventSchema.safeParse({
        ...base,
        kind: "context_pack_built",
        filesConsidered: -1,
        filesIncluded: 0,
        filesExcluded: 0,
        blocksConsidered: 0,
        blocksIncluded: 0,
        blocksExcluded: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      }).success,
    ).toBe(false);
  });
});
