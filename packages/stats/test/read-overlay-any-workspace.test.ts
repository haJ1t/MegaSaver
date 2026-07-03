import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StatsStore, readOverlaySummaryAnyWorkspace } from "../src/store.js";
import type { OverlaySessionTokenSaverStats } from "../src/summary.js";

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-any-ws-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const LSID = "1af7f8f0-0000-4000-8000-000000000000";

function summary(
  overrides: Partial<OverlaySessionTokenSaverStats> = {},
): OverlaySessionTokenSaverStats {
  return {
    liveSessionId: LSID,
    eventsTotal: 5,
    rawBytesTotal: 90000,
    returnedBytesTotal: 16507,
    bytesSavedTotal: 73493,
    savingRatio: 0.811,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 2,
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

describe("readOverlaySummaryAnyWorkspace", () => {
  it("returns the sorted-first workspaceKey match when the id exists in two workspaces", () => {
    writeSummary("bbb", LSID, summary({ eventsTotal: 9 }));
    writeSummary("aaa", LSID, summary({ eventsTotal: 5 }));

    const found = readOverlaySummaryAnyWorkspace(store, LSID);
    expect(found?.workspaceKey).toBe("aaa");
    expect(found?.summary.eventsTotal).toBe(5);
  });

  it("finds a summary present in exactly one workspace", () => {
    writeSummary("only", LSID, summary());

    const found = readOverlaySummaryAnyWorkspace(store, LSID);
    expect(found?.workspaceKey).toBe("only");
    expect(found?.summary.bytesSavedTotal).toBe(73493);
  });

  it("returns null when the id is in no workspace", () => {
    writeSummary("wk", "22222222-2222-4222-8222-222222222222", summary());

    expect(readOverlaySummaryAnyWorkspace(store, LSID)).toBeNull();
  });

  it("returns null when there is no stats dir", () => {
    expect(readOverlaySummaryAnyWorkspace(store, LSID)).toBeNull();
  });

  it("skips a workspace whose summary file is corrupt and still finds a valid one", () => {
    const badDir = join(root, "stats", "aaa");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, `${LSID}.json`), "{ not json");
    writeSummary("bbb", LSID, summary({ eventsTotal: 7 }));

    const found = readOverlaySummaryAnyWorkspace(store, LSID);
    expect(found?.workspaceKey).toBe("bbb");
    expect(found?.summary.eventsTotal).toBe(7);
  });
});
