import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StatsStore, readWorkspaceTokenSaverTotals } from "../src/store.js";
import type { OverlaySessionTokenSaverStats } from "../src/summary.js";

const WK = "e02b98f66e82b6b9";

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-ws-totals-"));
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
    rawBytesTotal: 90000,
    returnedBytesTotal: 16507,
    bytesSavedTotal: 73493,
    savingRatio: 0.811,
    secretsRedactedTotal: 1,
    chunksStoredTotal: 2,
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

function writeFile(name: string, contents: string): void {
  const dir = join(root, "stats", WK);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), contents);
}

function writeSummary(liveSessionId: string, data: OverlaySessionTokenSaverStats): void {
  writeFile(`${liveSessionId}.json`, JSON.stringify(data));
}

describe("readWorkspaceTokenSaverTotals", () => {
  it("sums only valid session summaries, excluding settings/workspace sibling files", () => {
    writeSummary("11111111-1111-4111-8111-111111111111", {
      ...summary(),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      eventsTotal: 2,
      rawBytesTotal: 1000,
      returnedBytesTotal: 200,
      bytesSavedTotal: 800,
      secretsRedactedTotal: 1,
      chunksStoredTotal: 1,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    writeSummary("22222222-2222-4222-8222-222222222222", {
      ...summary(),
      liveSessionId: "22222222-2222-4222-8222-222222222222",
      eventsTotal: 3,
      rawBytesTotal: 2000,
      returnedBytesTotal: 500,
      bytesSavedTotal: 1500,
      secretsRedactedTotal: 0,
      chunksStoredTotal: 4,
      updatedAt: "2026-07-03T12:00:00.000Z",
    });
    writeSummary("33333333-3333-4333-8333-333333333333", {
      ...summary(),
      liveSessionId: "33333333-3333-4333-8333-333333333333",
      eventsTotal: 5,
      rawBytesTotal: 7000,
      returnedBytesTotal: 700,
      bytesSavedTotal: 6300,
      secretsRedactedTotal: 2,
      chunksStoredTotal: 3,
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    // Sibling files that parse as JSON but are NOT overlay summaries.
    writeFile(
      "44444444-4444-4444-8444-444444444444.settings.json",
      JSON.stringify({ mode: "balanced", enabled: true }),
    );
    writeFile("workspace-token-saver.json", JSON.stringify({ workspaceKey: WK, enabled: true }));
    writeFile("session-intent.json", JSON.stringify({ intent: "refactor stats" }));
    // Not a .json file — must be ignored.
    writeFile("55555555-5555-4555-8555-555555555555.events.jsonl", '{"id":"e1"}\n');

    const totals = readWorkspaceTokenSaverTotals(store, WK);

    expect(totals).not.toBeNull();
    expect(totals?.workspaceKey).toBe(WK);
    expect(totals?.sessionsCount).toBe(3);
    expect(totals?.eventsTotal).toBe(10);
    expect(totals?.rawBytesTotal).toBe(10000);
    expect(totals?.returnedBytesTotal).toBe(1400);
    expect(totals?.bytesSavedTotal).toBe(8600);
    expect(totals?.secretsRedactedTotal).toBe(3);
    expect(totals?.chunksStoredTotal).toBe(8);
    expect(totals?.savingRatio).toBeCloseTo(8600 / 10000);
    expect(totals?.latestUpdatedAt).toBe("2026-07-03T12:00:00.000Z");
  });

  it("returns null when the workspace dir is missing", () => {
    expect(readWorkspaceTokenSaverTotals(store, WK)).toBeNull();
  });

  it("returns null when the workspace dir has no valid summaries", () => {
    writeFile("workspace-token-saver.json", JSON.stringify({ workspaceKey: WK }));
    writeFile("session-intent.json", JSON.stringify({ intent: "x" }));
    expect(readWorkspaceTokenSaverTotals(store, WK)).toBeNull();
  });

  it("skips a corrupt summary file and still sums the valid ones", () => {
    writeSummary("11111111-1111-4111-8111-111111111111", {
      ...summary(),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      eventsTotal: 4,
      rawBytesTotal: 1000,
      returnedBytesTotal: 100,
      bytesSavedTotal: 900,
    });
    writeFile("99999999-9999-4999-8999-999999999999.json", "{ not json");
    writeSummary("22222222-2222-4222-8222-222222222222", {
      ...summary(),
      liveSessionId: "22222222-2222-4222-8222-222222222222",
      eventsTotal: 6,
      rawBytesTotal: 4000,
      returnedBytesTotal: 400,
      bytesSavedTotal: 3600,
    });

    const totals = readWorkspaceTokenSaverTotals(store, WK);
    expect(totals?.sessionsCount).toBe(2);
    expect(totals?.eventsTotal).toBe(10);
    expect(totals?.rawBytesTotal).toBe(5000);
    expect(totals?.bytesSavedTotal).toBe(4500);
  });

  it("computes savingRatio 0 when rawBytesTotal is 0", () => {
    writeSummary("11111111-1111-4111-8111-111111111111", {
      ...summary(),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      eventsTotal: 0,
      rawBytesTotal: 0,
      returnedBytesTotal: 0,
      bytesSavedTotal: 0,
      savingRatio: 0,
      secretsRedactedTotal: 0,
      chunksStoredTotal: 0,
    });
    const totals = readWorkspaceTokenSaverTotals(store, WK);
    expect(totals?.savingRatio).toBe(0);
  });

  it("picks latestUpdatedAt by chronology when the later summary sorts lexically smaller", () => {
    // 13:00+02:00 == 11:00Z (earlier), but lexically GREATER than 12:00Z.
    writeSummary("11111111-1111-4111-8111-111111111111", {
      ...summary(),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      updatedAt: "2026-07-03T13:00:00.000+02:00",
    });
    // 12:00Z is chronologically later but lexically SMALLER than the string above.
    writeSummary("22222222-2222-4222-8222-222222222222", {
      ...summary(),
      liveSessionId: "22222222-2222-4222-8222-222222222222",
      updatedAt: "2026-07-03T12:00:00.000Z",
    });

    const totals = readWorkspaceTokenSaverTotals(store, WK);
    expect(totals?.latestUpdatedAt).toBe("2026-07-03T12:00:00.000Z");
  });
});
