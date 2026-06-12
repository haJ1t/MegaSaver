import { describe, expect, it } from "vitest";
import {
  type AuditEvent,
  type AuditSummary,
  appendAuditEvent,
  auditEventSchema,
  auditSummarySchema,
  auditWindowSchema,
  readAuditEvents,
  summarizeAudit,
} from "../src/index.js";

describe("core re-exports the Phase 8 audit surface", () => {
  it("exposes the audit fns and schemas", () => {
    expect(typeof summarizeAudit).toBe("function");
    expect(typeof appendAuditEvent).toBe("function");
    expect(typeof readAuditEvents).toBe("function");
    expect(auditWindowSchema.options).toEqual(["session", "week", "all"]);
    const summary: AuditSummary = summarizeAudit([], { window: "all", now: () => "2026-06-12T00:00:00.000Z" });
    expect(summary.eventsTotal).toBe(0);
    expect(auditSummarySchema.safeParse(summary).success).toBe(true);
    const event: AuditEvent = auditEventSchema.parse({
      id: "e",
      sessionId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-06-12T12:00:00.000Z",
      kind: "rule_applied",
    });
    expect(event.kind).toBe("rule_applied");
  });
});
