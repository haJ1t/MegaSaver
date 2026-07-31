import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PriceTableError, inputPricePerMTok, loadModelPriceTable } from "../src/model-prices.js";

const valid = {
  capturedAt: "2026-08-01",
  source: "public pricing pages, USD per million input tokens",
  unknownModelId: "claude-sonnet-5",
  prices: {
    "claude-opus-5": { inputPerMTokUsd: 15 },
    "claude-sonnet-5": { inputPerMTokUsd: 3 },
  },
};

describe("model-prices", () => {
  it("rejects a table with no capture date — an undated price is an undated claim", () => {
    const { capturedAt: _drop, ...undated } = valid;
    try {
      loadModelPriceTable(undated);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PriceTableError);
      expect((err as PriceTableError).code).toBe("missing_capture_date");
    }
  });

  it("rejects a table whose unknownModelId has no price entry", () => {
    try {
      loadModelPriceTable({ ...valid, unknownModelId: "not-in-table" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as PriceTableError).code).toBe("unknown_fallback_unpriced");
    }
  });

  it("prices a known model from the table", () => {
    const table = loadModelPriceTable(valid);
    expect(inputPricePerMTok(table, "claude-opus-5")).toEqual({ usd: 15, resolvedAs: "known" });
  });

  it("prices an absent model id at the declared fallback, flagged as unknown", () => {
    const table = loadModelPriceTable(valid);
    expect(inputPricePerMTok(table, undefined)).toEqual({ usd: 3, resolvedAs: "unknown" });
    expect(inputPricePerMTok(table, "some-other-model")).toEqual({ usd: 3, resolvedAs: "unknown" });
  });

  // Shape and date only. Asserting a number here would turn the suite red the
  // day a vendor changes its page, which is not a defect in this repo.
  it("ships a shipped table that parses and carries a date", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "..", "..", "scripts", "model-list-prices.json"), "utf8"),
    );
    const table = loadModelPriceTable(raw);
    expect(table.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(table.prices).length).toBeGreaterThan(0);
  });
});
