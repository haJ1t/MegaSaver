import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StatsStore, readAllWorkspaceTokenSaverTotals } from "../src/store.js";
import type { OverlaySessionTokenSaverStats } from "../src/summary.js";

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-all-ws-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function summary(
  overrides: Partial<OverlaySessionTokenSaverStats> = {},
): OverlaySessionTokenSaverStats {
  return {
    liveSessionId: "00000000-0000-4000-8000-000000000000",
    eventsTotal: 5,
    rawBytesTotal: 10000,
    returnedBytesTotal: 2000,
    bytesSavedTotal: 8000,
    savingRatio: 0.8,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

function writeSummary(
  workspaceKey: string,
  liveSessionId: string,
  data: OverlaySessionTokenSaverStats,
): void {
  const dir = join(root, "stats", workspaceKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${liveSessionId}.json`), JSON.stringify(data));
}

describe("readAllWorkspaceTokenSaverTotals", () => {
  it("sums totals across every workspace with a blended ratio", () => {
    writeSummary("aaaaaaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", {
      ...summary(),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      rawBytesTotal: 1000,
      returnedBytesTotal: 200,
      bytesSavedTotal: 800,
    });
    writeSummary("bbbbbbbbbbbbbbbb", "22222222-2222-4222-8222-222222222222", {
      ...summary(),
      liveSessionId: "22222222-2222-4222-8222-222222222222",
      rawBytesTotal: 2000,
      returnedBytesTotal: 500,
      bytesSavedTotal: 1500,
    });
    writeSummary("cccccccccccccccc", "33333333-3333-4333-8333-333333333333", {
      ...summary(),
      liveSessionId: "33333333-3333-4333-8333-333333333333",
      rawBytesTotal: 7000,
      returnedBytesTotal: 700,
      bytesSavedTotal: 6300,
    });

    const totals = readAllWorkspaceTokenSaverTotals(store);

    expect(totals.workspaceCount).toBe(3);
    expect(totals.sessionsCount).toBe(3);
    expect(totals.bytesSavedTotal).toBe(8600);
    // Blended ratio = sum(saved) / sum(raw) = 8600 / 10000.
    expect(totals.savingRatio).toBeCloseTo(8600 / 10000);
  });

  it("skips a workspace with no valid summaries, keeping the rest intact", () => {
    writeSummary("aaaaaaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", {
      ...summary(),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      rawBytesTotal: 1000,
      returnedBytesTotal: 200,
      bytesSavedTotal: 800,
    });
    // A workspace dir whose only file is not a valid summary -> skipped.
    const dir = join(root, "stats", "bbbbbbbbbbbbbbbb");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "workspace-token-saver.json"), JSON.stringify({ enabled: true }));

    const totals = readAllWorkspaceTokenSaverTotals(store);

    expect(totals.workspaceCount).toBe(1);
    expect(totals.sessionsCount).toBe(1);
    expect(totals.bytesSavedTotal).toBe(800);
  });

  it("returns all zeros when the stats dir is missing", () => {
    const totals = readAllWorkspaceTokenSaverTotals(store);
    expect(totals.workspaceCount).toBe(0);
    expect(totals.sessionsCount).toBe(0);
    expect(totals.bytesSavedTotal).toBe(0);
    expect(totals.savingRatio).toBe(0);
  });
});
