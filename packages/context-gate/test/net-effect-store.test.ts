import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readNetEffectRecord, writeNetEffectRecord } from "../src/net-effect-store.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-neteffect-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

const WK = "wk1";
const NOW = "2026-07-19T12:00:00.000Z";

describe("net-effect store", () => {
  it("round-trips a verdict record", () => {
    writeNetEffectRecord(store, WK, {
      savedTokens: 100,
      excessTokens: 900,
      verdict: "negative",
      updatedAt: NOW,
    });
    expect(readNetEffectRecord(store, WK)).toEqual({
      savedTokens: 100,
      excessTokens: 900,
      verdict: "negative",
      updatedAt: NOW,
    });
  });

  it("missing record reads as null", () => {
    expect(readNetEffectRecord(store, WK)).toBeNull();
  });

  it("corrupt file reads as null", () => {
    writeNetEffectRecord(store, WK, {
      savedTokens: 1,
      excessTokens: 99,
      verdict: "negative",
      updatedAt: NOW,
    });
    writeFileSync(join(store, "stats", WK, "net-effect.json"), "{corrupt");
    expect(readNetEffectRecord(store, WK)).toBeNull();
  });

  // The verdict is an unattributed dispersion advisory (see @megasaver/stats
  // net-effect.ts) — it must never be able to switch the saver off.
  it("exposes no way to pause or resume the saver", async () => {
    const mod = await import("../src/index.js");
    expect(Object.keys(mod).filter((k) => /paus|resume/i.test(k))).toEqual([]);
  });
});
