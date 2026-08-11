import { describe, expect, it } from "vitest";
import { buildAuditionReport, renderAuditionReport } from "../../src/audition/report.js";

describe("audition report", () => {
  it("counters sum", () => {
    const report = buildAuditionReport([{ name: "read", rawBytes: 1000, deliveredBytes: 500, chunks: 1, exitCode: 0 }]);
    expect(report.fixtures).toHaveLength(1);
    expect(report.verdict).toContain("byte counter");
  });

  it("render contains fixtures", () => {
    const report = buildAuditionReport([{ name: "read", rawBytes: 100, deliveredBytes: 50, chunks: 1, exitCode: 0 }]);
    const text = renderAuditionReport(report);
    expect(text).toContain("read");
    expect(text).toContain("not a bill claim");
  });
});
