import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/audit-event.js";
import { summarizeAudit } from "../src/audit-summary.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-06-12T12:00:00.000Z";
const env = { window: "all" as const, now: () => NOW };

const base = (createdAt = NOW) => ({
  id: "e",
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  createdAt,
});

const pack = (overrides: Partial<AuditEvent> = {}): AuditEvent =>
  ({
    ...base(),
    kind: "context_pack_built",
    filesConsidered: 5,
    filesIncluded: 2,
    filesExcluded: 3,
    blocksConsidered: 8,
    blocksIncluded: 3,
    blocksExcluded: 5,
    tokensBefore: 7000,
    tokensAfter: 2300,
    ...overrides,
  }) as AuditEvent;

describe("summarizeAudit", () => {
  it("returns an all-zero summary for no events", () => {
    const s = summarizeAudit([], env);
    expect(s.eventsTotal).toBe(0);
    expect(s.tokensBefore).toBe(0);
    expect(s.tokensSaved).toBe(0);
    expect(s.percentageSaved).toBe(0);
  });

  it("folds a single context_pack_built event and derives savings", () => {
    const s = summarizeAudit([pack()], env);
    expect(s.tokensBefore).toBe(7000);
    expect(s.tokensAfter).toBe(2300);
    expect(s.tokensSaved).toBe(4700);
    expect(s.percentageSaved).toBe(Math.round((4700 / 7000) * 100));
    expect(s.filesConsidered).toBe(5);
    expect(s.blocksIncluded).toBe(3);
  });

  it("sums multiple packs", () => {
    const s = summarizeAudit([pack(), pack()], env);
    expect(s.tokensBefore).toBe(14000);
    expect(s.tokensAfter).toBe(4600);
    expect(s.filesConsidered).toBe(10);
  });

  it("counts FORGE, memory, and tool events", () => {
    const events: AuditEvent[] = [
      { ...base(), kind: "rule_applied" } as AuditEvent,
      { ...base(), kind: "rule_applied" } as AuditEvent,
      { ...base(), kind: "failure_avoided", retryTokensAvoided: 1200 } as AuditEvent,
      { ...base(), kind: "memory_retrieved" } as AuditEvent,
      {
        ...base(),
        kind: "tool_route",
        toolsConsidered: 10,
        toolsAllowed: 3,
        toolSchemasReduced: 7,
      } as AuditEvent,
    ];
    const s = summarizeAudit(events, env);
    expect(s.rulesApplied).toBe(2);
    expect(s.repeatedFailuresAvoided).toBe(1);
    expect(s.retryCostSaved).toBe(1200);
    expect(s.memoriesRetrieved).toBe(1);
    expect(s.toolSchemasReduced).toBe(7);
    expect(s.eventsTotal).toBe(5);
  });

  it("floors tokensSaved at 0 when after > before", () => {
    const s = summarizeAudit([pack({ tokensBefore: 100, tokensAfter: 200 })], env);
    expect(s.tokensSaved).toBe(0);
    expect(s.percentageSaved).toBe(0);
  });

  it("filters by the week window using injected now", () => {
    const sixDaysAgo = "2026-06-06T12:00:00.000Z";
    const eightDaysAgo = "2026-06-04T12:00:00.000Z";
    const events = [pack({ createdAt: sixDaysAgo }), pack({ createdAt: eightDaysAgo })];
    const s = summarizeAudit(events, { window: "week", now: () => NOW });
    expect(s.eventsTotal).toBe(1);
    expect(s.tokensBefore).toBe(7000);
  });
});
