import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TokenSaverEvent } from "../src/event.js";
import {
  type StatsStore,
  appendEvent,
  readOverlaySummaryAnyWorkspace,
  readSummary,
} from "../src/store.js";
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

const WS_A = "00000000000000aa";
const WS_B = "00000000000000bb";
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

const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;
const LEGACY_SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;

const legacySummaryFile = () => join(root, "stats", PROJECT_ID, `${LEGACY_SESSION_ID}.json`);

const legacyEvent = (): TokenSaverEvent =>
  ({
    id: "evt-1",
    sessionId: LEGACY_SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-07-25T12:00:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 10_000,
    returnedBytes: 1000,
    bytesSaved: 9000,
    savingRatio: 0.9,
    summary: "s",
    mode: "balanced",
  }) as TokenSaverEvent;

describe("readOverlaySummaryAnyWorkspace", () => {
  it("returns the sorted-first workspaceKey match when the id exists in two workspaces", () => {
    writeSummary(WS_B, LSID, summary({ eventsTotal: 9 }));
    writeSummary(WS_A, LSID, summary({ eventsTotal: 5 }));

    const found = readOverlaySummaryAnyWorkspace(store, LSID);
    expect(found?.workspaceKey).toBe(WS_A);
    expect(found?.summary.eventsTotal).toBe(5);
  });

  it("finds a summary present in exactly one workspace", () => {
    writeSummary(WS_A, LSID, summary());

    const found = readOverlaySummaryAnyWorkspace(store, LSID);
    expect(found?.workspaceKey).toBe(WS_A);
    expect(found?.summary.bytesSavedTotal).toBe(73493);
  });

  it("returns null when the id is in no workspace", () => {
    writeSummary(WS_A, "22222222-2222-4222-8222-222222222222", summary());

    expect(readOverlaySummaryAnyWorkspace(store, LSID)).toBeNull();
  });

  it("returns null when there is no stats dir", () => {
    expect(readOverlaySummaryAnyWorkspace(store, LSID)).toBeNull();
  });

  it("leaves a legacy registry summary intact when scanning for its session id", () => {
    appendEvent({ store, event: legacyEvent(), secretsRedacted: 2, chunksStored: 3 });
    const before = readFileSync(legacySummaryFile(), "utf8");

    expect(readOverlaySummaryAnyWorkspace(store, LEGACY_SESSION_ID)).toBeNull();

    expect(readFileSync(legacySummaryFile(), "utf8")).toBe(before);
    const summary = readSummary(store, PROJECT_ID, LEGACY_SESSION_ID);
    expect(summary?.bytesSavedTotal).toBe(9000);
    expect(summary?.secretsRedactedTotal).toBe(2);
  });

  it("self-heals a corrupt summary file during an any-workspace scan", () => {
    const badDir = join(root, "stats", WS_A);
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, `${LSID}.json`), "{ not json");
    writeSummary(WS_B, LSID, summary({ eventsTotal: 7 }));

    // E24: a corrupt summary is now rebuilt from its events JSONL rather than
    // skipped. With no events file next to it, WS_A heals to an empty summary
    // and — sorted first — is returned ahead of the valid WS_B.
    const found = readOverlaySummaryAnyWorkspace(store, LSID);
    expect(found?.workspaceKey).toBe(WS_A);
    expect(found?.summary.eventsTotal).toBe(0);
    expect(found?.summary.rebuiltAt).toBeDefined();
  });
});
