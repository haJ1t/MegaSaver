import { describe, expect, it } from "vitest";
import {
  computeYieldAudit,
  fingerprintMemory,
  tierFor,
  yieldAuditReportSchema,
} from "../../src/yield-audit/compute.js";

describe("yield audit compute wrapper", () => {
  it("all freeloaders via wrapper", () => {
    const r = computeYieldAudit({
      injected: [{ id: "m1", content: "fix foo" }],
      evidence: [],
      readIndexEntries: [],
      diffAddedLines: [],
      window: { from: "2026-08-04T00:00:00.000Z", to: "2026-08-11T00:00:00.000Z" },
    });
    expect(r.rows[0]?.yield).toBe(0);
    expect(r.rows[0]?.tier).toBe("FREELOADER");
    expect(() => yieldAuditReportSchema.parse(r)).not.toThrow();
  });

  it("strict rejects extra key", () => {
    expect(() => yieldAuditReportSchema.parse({ x: 1 })).toThrow();
  });

  it("fingerprint via wrapper", () => {
    expect(fingerprintMemory("Hello world foo bar").length).toBeGreaterThan(0);
  });

  it("tier thresholds via wrapper", () => {
    expect(tierFor(0.6)).toBe("HOT");
    expect(tierFor(0.2)).toBe("COLD");
    expect(tierFor(0.05)).toBe("FREELOADER");
  });
});
