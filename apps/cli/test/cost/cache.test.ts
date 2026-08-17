import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  costCachePath,
  readCostCache,
  savingsFingerprint,
  writeCostCache,
} from "../../src/commands/cost/cache.js";
import { collectSavingsReceipts } from "../../src/commands/cost/collect.js";

const WORKSPACE = "00000000000000aa";
const OVERLAY_SESSION = "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6";
const TS = "2026-08-06T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-cost-cache-"));
  mkdirSync(join(root, "stats", WORKSPACE), { recursive: true });
  writeFileSync(
    join(root, "stats", WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`),
    `${JSON.stringify({ createdAt: TS, deltaTokens: 42 })}\n`,
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cost savings cache", () => {
  it("round-trips receipts when the fingerprint matches", () => {
    const fingerprint = savingsFingerprint(root);
    const savings = collectSavingsReceipts(root);
    writeCostCache(root, fingerprint, savings);
    expect(readCostCache(root, fingerprint)).toEqual(savings);
  });

  it("misses after a source file changes (size drives this — no wall-clock reliance)", () => {
    const before = savingsFingerprint(root);
    writeCostCache(root, before, collectSavingsReceipts(root));
    appendFileSync(
      join(root, "stats", WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`),
      `${JSON.stringify({ createdAt: TS, deltaTokens: 7 })}\n`,
    );
    expect(readCostCache(root, savingsFingerprint(root))).toBeUndefined();
  });

  it("misses on a corrupt or absent cache file", () => {
    const fingerprint = savingsFingerprint(root);
    expect(readCostCache(root, fingerprint)).toBeUndefined();
    mkdirSync(join(root, "cost-ledger"), { recursive: true });
    writeFileSync(costCachePath(root), "not json");
    expect(readCostCache(root, fingerprint)).toBeUndefined();
  });

  it("swallows write failures (cache is best-effort, never fatal)", () => {
    rmSync(root, { recursive: true, force: true });
    // Parent gone: mkdir/write will fail; the ledger must not care.
    expect(() => writeCostCache("/nonexistent-root/nested", [], [])).not.toThrow();
  });
});
