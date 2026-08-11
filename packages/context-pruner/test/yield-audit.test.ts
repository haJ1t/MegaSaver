import { describe, expect, it } from "vitest";
import {
  computeYieldAudit,
  fingerprintMemory,
  tierFor,
  yieldAuditReportSchema,
} from "../src/yield-audit.js";

describe("yield audit", () => {
  it("all freeloaders", () => {
    const r = computeYieldAudit({
      injected: [{ id: "m1", content: "fix foo" }],
      evidence: [],
      readIndexEntries: [],
      diffAddedLines: [],
      window: {
        from: "2026-08-04T00:00:00.000Z",
        to: "2026-08-11T00:00:00.000Z",
      },
    });
    expect(r.rows[0]?.yield).toBe(0);
    expect(r.rows[0]?.tier).toBe("FREELOADER");
    expect(() => yieldAuditReportSchema.parse(r)).not.toThrow();
  });

  it("caps at 50 rows", () => {
    const injected = Array.from({ length: 55 }, (_, i) => ({
      id: `m${i}`,
      content: `c${i}`,
    }));
    const r = computeYieldAudit({
      injected,
      evidence: [],
      readIndexEntries: [],
      diffAddedLines: [],
      window: {
        from: "2026-08-04T00:00:00.000Z",
        to: "2026-08-11T00:00:00.000Z",
      },
    });
    expect(r.rows.length).toBe(50);
    expect(r.aggregatedRemaining).toBe(5);
  });

  it("strict rejects extra key", () => {
    expect(() => yieldAuditReportSchema.parse({ x: 1 })).toThrow();
  });

  it("fingerprint 3-grams", () => {
    expect(fingerprintMemory("Hello world foo bar").length).toBeGreaterThan(0);
  });

  it("tier thresholds", () => {
    expect(tierFor(0.6)).toBe("HOT");
    expect(tierFor(0.2)).toBe("COLD");
    expect(tierFor(0.05)).toBe("FREELOADER");
  });

  it("reused via readIndex", () => {
    const r = computeYieldAudit({
      injected: [{ id: "mem1", content: "remember foo", relatedFiles: ["src/a.ts"] }],
      evidence: [],
      readIndexEntries: [{ path: "src/a.ts", sessionId: "s1", at: "2026-08-05T00:00:00.000Z" }],
      diffAddedLines: [],
      window: {
        from: "2026-08-04T00:00:00.000Z",
        to: "2026-08-11T00:00:00.000Z",
      },
    });
    expect(r.rows[0]?.reusedAtLeast).toBe(1);
    expect(r.rows[0]?.yield).toBe(1);
  });

  it("reused via diff fingerprint", () => {
    const content = "fix the payment handler for stripe checkout";
    const r = computeYieldAudit({
      injected: [{ id: "mem2", content }],
      evidence: [],
      readIndexEntries: [],
      diffAddedLines: ["+ fix the payment handler for stripe checkout was updated"],
      window: {
        from: "2026-08-04T00:00:00.000Z",
        to: "2026-08-11T00:00:00.000Z",
      },
    });
    expect(r.rows[0]?.reusedAtLeast).toBe(1);
  });

  it("sorted by yield asc then injected desc", () => {
    const r = computeYieldAudit({
      injected: [
        { id: "m1", content: "a" },
        { id: "m2", content: "b" },
      ],
      evidence: [{ chunkSetId: "cs1", decisionTraceIds: ["m2"], relatedFilesInChunk: [] }],
      readIndexEntries: [],
      diffAddedLines: [],
      window: {
        from: "2026-08-04T00:00:00.000Z",
        to: "2026-08-11T00:00:00.000Z",
      },
    });
    // m1 yield 0 → first, m2 yield 1 → last
    expect(r.rows[0]?.id).toBe("m1");
    expect(r.rows[1]?.id).toBe("m2");
  });
});
