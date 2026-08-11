import { describe, expect, it } from "vitest";
import { buildAuditionReport } from "../../src/audition/report.js";

describe("audition", () => {
  it("builds report", () => {
    const r = buildAuditionReport([
      { name: "read", rawBytes: 1000, deliveredBytes: 500, chunks: 1, exitCode: 0 },
    ]);
    expect(r.fixtures).toHaveLength(1);
  });
});
