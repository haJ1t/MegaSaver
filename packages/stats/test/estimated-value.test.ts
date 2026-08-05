import { describe, expect, it } from "vitest";
import { estimateSavedValue } from "../src/estimated-value.js";
import { MODEL_LIST_PRICES, loadModelPriceTable } from "../src/model-prices.js";

const table = loadModelPriceTable({
  capturedAt: "2026-08-01",
  source: "test",
  unknownModelId: "claude-sonnet-5",
  prices: {
    "claude-opus-5": { inputPerMTokUsd: 15 },
    "claude-sonnet-5": { inputPerMTokUsd: 3 },
  },
});

describe("estimated-value", () => {
  it("sums measured tokens per model at that model's price", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: 1_000_000, modelId: "claude-sonnet-5", deltaBytes: 0 },
      ],
      table,
    );

    expect(out.netTokensMeasured).toBe(2_000_000);
    expect(out.estimatedUsd).toBeCloseTo(18, 10);
    expect(out.unknownModelTokenShare).toBe(0);
    expect(out.measuredCoverage).toBe(1);
  });

  it("keeps the estimate negative when recovery outweighed compression", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: -2_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
      ],
      table,
    );

    expect(out.netTokensMeasured).toBe(-1_000_000);
    expect(out.estimatedUsd).toBeCloseTo(-15, 10);
  });

  it("prices an unknown model at the fallback and raises the unknown share", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: 1_000_000, deltaBytes: 0 },
      ],
      table,
    );

    expect(out.estimatedUsd).toBeCloseTo(18, 10);
    expect(out.unknownModelTokenShare).toBeCloseTo(0.5, 10);
  });

  // The shares must be computed on MAGNITUDE, not on the signed net. With one
  // positive known row and one negative unknown row the net is exactly zero, so
  // a net-based share reports 0% unknown for a window that is half unknown —
  // and the all-positive test above cannot see the difference, because there
  // Math.abs is the identity.
  it("reports the unknown share on magnitude when signs differ and the net is zero", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: -1_000_000, deltaBytes: 0 },
      ],
      table,
    );

    expect(out.netTokensMeasured).toBe(0);
    expect(out.unknownModelTokenShare).toBeCloseTo(0.5, 10);
  });

  it("keeps the unknown share a proportion — never negative, never above 1", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 3_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: -1_000_000, deltaBytes: 0 },
      ],
      table,
    );

    expect(out.unknownModelTokenShare).toBeGreaterThanOrEqual(0);
    expect(out.unknownModelTokenShare).toBeLessThanOrEqual(1);
    expect(out.unknownModelTokenShare).toBeCloseTo(0.25, 10);
  });

  it("reports coverage below 1 when a row carries no measured tokens", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaBytes: 4_000_000, modelId: "claude-opus-5" },
      ],
      table,
    );

    expect(out.measuredCoverage).toBeCloseTo(0.5, 10);
    // The unmeasured row's bytes are reported separately, never folded into
    // netTokensMeasured — a measured total must contain only measured tokens.
    expect(out.netTokensMeasured).toBe(1_000_000);
    expect(out.unmeasuredTokensEstimated).toBe(1_000_000);
  });

  it("returns zeroed totals and full coverage for an empty window", () => {
    const out = estimateSavedValue([], table);
    expect(out.netTokensMeasured).toBe(0);
    expect(out.estimatedUsd).toBe(0);
    expect(out.measuredCoverage).toBe(1);
  });
});
