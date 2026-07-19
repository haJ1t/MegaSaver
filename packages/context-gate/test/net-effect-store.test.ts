import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readNetEffectRecord,
  saverPausedByNetEffect,
  writeNetEffectRecord,
  writeResumeOverride,
} from "../src/net-effect-store.js";

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
      churnTokens: 900,
      verdict: "negative",
      updatedAt: NOW,
    });
    expect(readNetEffectRecord(store, WK)?.verdict).toBe("negative");
  });

  it("pause predicate: negative verdict pauses, ok/unknown/missing do not", () => {
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
    writeNetEffectRecord(store, WK, {
      savedTokens: 1,
      churnTokens: 0,
      verdict: "ok",
      updatedAt: NOW,
    });
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
    writeNetEffectRecord(store, WK, {
      savedTokens: 0,
      churnTokens: 0,
      verdict: "unknown",
      updatedAt: NOW,
    });
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
    writeNetEffectRecord(store, WK, {
      savedTokens: 1,
      churnTokens: 99,
      verdict: "negative",
      updatedAt: NOW,
    });
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(true);
  });

  it("resume override lifts the pause for 7 days, then it re-arms", () => {
    writeNetEffectRecord(store, WK, {
      savedTokens: 1,
      churnTokens: 99,
      verdict: "negative",
      updatedAt: NOW,
    });
    writeResumeOverride(store, WK, NOW);
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
    const eightDaysLater = "2026-07-27T12:00:01.000Z";
    expect(saverPausedByNetEffect(store, WK, eightDaysLater)).toBe(true);
  });

  it("corrupt file reads as null and never pauses", () => {
    writeNetEffectRecord(store, WK, {
      savedTokens: 1,
      churnTokens: 99,
      verdict: "negative",
      updatedAt: NOW,
    });
    writeFileSync(join(store, "stats", WK, "net-effect.json"), "{corrupt");
    expect(readNetEffectRecord(store, WK)).toBeNull();
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
  });

  it("unparseable nowIso never pauses (fail-open)", () => {
    writeNetEffectRecord(store, WK, {
      savedTokens: 1,
      churnTokens: 99,
      verdict: "negative",
      updatedAt: NOW,
    });
    expect(saverPausedByNetEffect(store, WK, "not-a-date")).toBe(false);
  });
});
