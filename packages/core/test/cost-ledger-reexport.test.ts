import { describe, expect, it } from "vitest";
import { UNKNOWN_COST_BUCKET, buildCostLedger, costFacetSchema } from "../src/index.js";

describe("core re-exports the cost-ledger surface", () => {
  it("exposes the pure builder, facet schema, and bucket constant", () => {
    expect(typeof buildCostLedger).toBe("function");
    expect(costFacetSchema.options).toEqual(["project", "task", "agent", "session"]);
    expect(UNKNOWN_COST_BUCKET).toBe("UNKNOWN");
    const ledger = buildCostLedger({
      facet: "project",
      usage: [],
      savings: [],
      sessionMeta: new Map(),
      skippedUsageLines: 0,
    });
    expect(ledger.groups).toEqual([]);
    expect(ledger.totals.spendReceipts).toBe(0);
  });
});
