import { describe, expect, it } from "vitest";
import { renderSavedValueLines } from "../../src/commands/audit/shared.js";

const estimate = {
  netTokensMeasured: 1_284_300,
  unmeasuredTokensEstimated: 0,
  measuredCoverage: 1,
  unknownModelTokenShare: 0.27,
  estimatedUsd: 8.42,
  capturedAt: "2026-08-01",
};

describe("audit token headline", () => {
  it("puts tokens above dollars", () => {
    const lines = renderSavedValueLines(estimate);
    const tokenLine = lines.findIndex((l) => l.includes("1,284,300"));
    const dollarLine = lines.findIndex((l) => l.includes("8.42"));

    expect(tokenLine).toBeGreaterThanOrEqual(0);
    expect(tokenLine).toBeLessThan(dollarLine);
  });

  it("never renders a dollar figure without (est.), the date, and the caveat", () => {
    const joined = renderSavedValueLines(estimate).join("\n");

    expect(joined).toContain("(est.)");
    expect(joined).toContain("2026-08-01");
    expect(joined.toLowerCase()).not.toContain("upper bound");
    expect(joined).toContain("flat input-rate estimate; the same tokens would have been cache-written");
    expect(joined).toContain("closer to a floor than a cap");
  });

  it("shows the unknown-model share when it is non-zero", () => {
    expect(renderSavedValueLines(estimate).join("\n")).toContain("27%");
  });

  it("prints a coverage line only when coverage is below 100%", () => {
    expect(renderSavedValueLines(estimate).join("\n")).not.toContain("coverage");
    expect(renderSavedValueLines({ ...estimate, measuredCoverage: 0.84 }).join("\n")).toContain(
      "84%",
    );
  });
});
