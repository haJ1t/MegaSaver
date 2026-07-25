import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TokenSaverEvent } from "../src/event.js";
import {
  type StatsStore,
  appendEvent,
  readEvents,
  readSummary,
  reconcileOverlaySummaries,
} from "../src/store.js";
import { sessionTokenSaverStatsSchema } from "../src/summary.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-clobber-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const summaryFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.json`);

const makeEvent = (overrides: Partial<TokenSaverEvent> = {}): TokenSaverEvent =>
  ({
    id: "evt-1",
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-05-10T12:00:00.000Z",
    sourceKind: "file",
    label: "read",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    savingRatio: 0.8,
    summary: "s",
    mode: "balanced",
    ...overrides,
  }) as TokenSaverEvent;

// Byte-for-byte what the pre-fix reconcileOverlaySummaries wrote when it walked
// a registry project dir as if it were an overlay workspace: registry events
// fail the overlay event schema, so the rebuild folded zero rows.
function clobberWithOverlaySummary(): void {
  writeFileSync(
    summaryFile(),
    JSON.stringify({
      liveSessionId: SESSION_ID,
      eventsTotal: 0,
      rawBytesTotal: 0,
      returnedBytesTotal: 0,
      bytesSavedTotal: 0,
      savingRatio: 0,
      secretsRedactedTotal: 0,
      chunksStoredTotal: 0,
      updatedAt: "2026-07-25T00:00:00.000Z",
      rebuiltAt: "2026-07-25T00:00:00.000Z",
    }),
    { flag: "w" },
  );
}

describe("registry summary clobbered by the pre-fix overlay GC sweep", () => {
  it("is left untouched by the fixed sweep, so nothing else can repair it", () => {
    appendEvent({ store, event: makeEvent(), secretsRedacted: 2, chunksStored: 3 });
    clobberWithOverlaySummary();
    expect(reconcileOverlaySummaries(store)).toBe(0);
    expect(readEvents(store, PROJECT_ID, SESSION_ID)).toHaveLength(1);
  });

  it("readSummary rebuilds it from the events JSONL instead of throwing", () => {
    appendEvent({ store, event: makeEvent(), secretsRedacted: 2, chunksStored: 3 });
    clobberWithOverlaySummary();

    const repaired = readSummary(store, PROJECT_ID, SESSION_ID);
    expect(repaired?.eventsTotal).toBe(1);
    expect(repaired?.rawBytesTotal).toBe(1000);
    expect(repaired?.returnedBytesTotal).toBe(200);
    expect(repaired?.bytesSavedTotal).toBe(800);
    expect(repaired?.savingRatio).toBeCloseTo(0.8);

    // The repair is persisted, so the next read is a plain schema hit.
    const onDisk = sessionTokenSaverStatsSchema.safeParse(
      JSON.parse(readFileSync(summaryFile(), "utf8")),
    );
    expect(onDisk.success).toBe(true);
  });

  it("appendEvent recovers and folds prior events plus the new one exactly once", () => {
    appendEvent({ store, event: makeEvent({ id: "e1" }), secretsRedacted: 2, chunksStored: 3 });
    clobberWithOverlaySummary();

    const next = appendEvent({
      store,
      event: makeEvent({ id: "e2", rawBytes: 3000, returnedBytes: 600, bytesSaved: 2400 }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(next.eventsTotal).toBe(2);
    expect(next.rawBytesTotal).toBe(4000);
    expect(next.bytesSavedTotal).toBe(3200);
  });
});
