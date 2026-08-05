import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODEL_LIST_PRICES,
  PriceTableError,
  inputPricePerMTok,
  loadModelPriceTable,
} from "../src/model-prices.js";

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

  // Compares against the JSON file so a coordinated price update stays green
  // while ensuring the shipped TS constant never drifts from scripts/model-list-prices.json.
  it("keeps the shipped constant in sync with scripts/model-list-prices.json", () => {
    const json = JSON.parse(
      readFileSync(join(process.cwd(), "..", "..", "scripts", "model-list-prices.json"), "utf8"),
    );
    expect(MODEL_LIST_PRICES).toEqual(json);
    // The constant must itself be a valid table — same gate the JSON passes.
    expect(loadModelPriceTable(MODEL_LIST_PRICES).capturedAt).toBe(json.capturedAt);
  });
});
