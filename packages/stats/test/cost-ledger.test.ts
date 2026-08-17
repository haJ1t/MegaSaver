import { describe, expect, it } from "vitest";
import {
  type SavingsReceipt,
  type SpendReceipt,
  UNKNOWN_COST_BUCKET,
  buildCostLedger,
  costFacetSchema,
} from "../src/cost-ledger.js";

const spend = (o: Partial<SpendReceipt> = {}): SpendReceipt => ({
  ts: "2026-08-06T10:00:00.000Z",
  model: "claude-sonnet-5",
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 1000,
  cacheCreationTokens: 200,
  ...o,
});

const saving = (o: Partial<SavingsReceipt> = {}): SavingsReceipt => ({
  createdAt: "2026-08-06T10:00:00.000Z",
  ...o,
});

const build = (o: Partial<Parameters<typeof buildCostLedger>[0]> = {}) =>
  buildCostLedger({
    facet: "project",
    usage: [],
    savings: [],
    sessionMeta: new Map(),
    skippedUsageLines: 0,
    ...o,
  });

describe("buildCostLedger", () => {
  it("exposes exactly the four facets", () => {
    expect(costFacetSchema.options).toEqual(["project", "task", "agent", "session"]);
  });

  it("returns no groups and zero totals for empty inputs", () => {
    const ledger = build();
    expect(ledger.groups).toEqual([]);
    expect(ledger.totals.spendReceipts).toBe(0);
    expect(ledger.totals.measuredSavedTokens).toBe(0);
  });

  it("project facet: stamped usage keys by workspaceKey, unstamped goes UNKNOWN", () => {
    const ledger = build({
      usage: [spend({ workspaceKey: "00000000000000aa" }), spend()],
    });
    expect(ledger.groups.map((g) => g.key)).toEqual([
      "00000000000000aa",
      UNKNOWN_COST_BUCKET,
    ]);
    expect(ledger.totals.spendReceipts).toBe(2);
    expect(ledger.totals.inputTokens).toBe(200);
  });

  it("session/agent/task facets: usage rows always land in UNKNOWN (no signal on the row)", () => {
    for (const facet of ["session", "agent", "task"] as const) {
      const ledger = build({ facet, usage: [spend({ workspaceKey: "00000000000000aa" })] });
      expect(ledger.groups).toHaveLength(1);
      expect(ledger.groups[0]?.key).toBe(UNKNOWN_COST_BUCKET);
    }
  });

  it("savings: measured pair adds tokens; pair-less rows are counted, never converted", () => {
    const ledger = build({
      savings: [
        saving({ project: "00000000000000aa", deltaTokens: 500 }),
        saving({ project: "00000000000000aa" }),
      ],
    });
    const group = ledger.groups[0];
    expect(group?.key).toBe("00000000000000aa");
    expect(group?.measuredSavedTokens).toBe(500);
    expect(group?.measuredSavingsReceipts).toBe(1);
    expect(group?.unmeasuredSavingsRows).toBe(1);
  });

  it("agent and task facets key savings through sessionMeta; missing meta goes UNKNOWN", () => {
    const meta = new Map([["sess-1", { agent: "claude-code", task: "cost ledger" }]]);
    const rows = [
      saving({ session: "sess-1", deltaTokens: 10 }),
      saving({ session: "sess-2", deltaTokens: 20 }),
    ];
    const byAgent = build({ facet: "agent", savings: rows, sessionMeta: meta });
    expect(byAgent.groups.map((g) => g.key)).toEqual(["claude-code", UNKNOWN_COST_BUCKET]);
    const byTask = build({ facet: "task", savings: rows, sessionMeta: meta });
    expect(byTask.groups.map((g) => g.key)).toEqual(["cost ledger", UNKNOWN_COST_BUCKET]);
  });

  it("sinceMs windows both sides", () => {
    const ledger = build({
      sinceMs: Date.parse("2026-08-06T00:00:00.000Z"),
      usage: [spend(), spend({ ts: "2026-08-01T00:00:00.000Z" })],
      savings: [
        saving({ project: "p", deltaTokens: 5 }),
        saving({ project: "p", deltaTokens: 7, createdAt: "2026-08-01T00:00:00.000Z" }),
      ],
    });
    expect(ledger.totals.spendReceipts).toBe(1);
    expect(ledger.totals.measuredSavedTokens).toBe(5);
  });

  it("orders named groups by spend tokens desc and pins UNKNOWN last even when largest", () => {
    const ledger = build({
      usage: [
        spend({ inputTokens: 1_000_000 }), // unstamped -> UNKNOWN, biggest spender
        spend({ workspaceKey: "00000000000000aa", inputTokens: 10 }),
        spend({ workspaceKey: "00000000000000bb", inputTokens: 99 }),
      ],
    });
    expect(ledger.groups.map((g) => g.key)).toEqual([
      "00000000000000bb",
      "00000000000000aa",
      UNKNOWN_COST_BUCKET,
    ]);
  });

  it("passes skippedUsageLines through untouched", () => {
    expect(build({ skippedUsageLines: 3 }).skippedUsageLines).toBe(3);
  });
});
