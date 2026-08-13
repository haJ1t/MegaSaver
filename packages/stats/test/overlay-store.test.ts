import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import {
  type StatsStore,
  appendOverlayEvent,
  readOverlayEvents,
  readOverlaySummary,
  resetOverlayOnDisable,
} from "../src/store.js";

const WK = "0123456789abcdef";
const LSID = "11111111-1111-4111-8111-111111111111";

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-overlay-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const eventFile = () => join(root, "stats", WK, `${LSID}.events.jsonl`);
const summaryFile = () => join(root, "stats", WK, `${LSID}.json`);

const makeEvent = (overrides: Partial<OverlayTokenSaverEvent> = {}): OverlayTokenSaverEvent =>
  ({
    id: "evt-1",
    workspaceKey: WK,
    liveSessionId: LSID,
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
  }) as OverlayTokenSaverEvent;

describe("appendOverlayEvent", () => {
  it("writes stats/<wk>/<lsid>.events.jsonl and the summary json", () => {
    const summary = appendOverlayEvent({
      store,
      event: makeEvent(),
      secretsRedacted: 2,
      chunksStored: 3,
    });
    expect(existsSync(eventFile())).toBe(true);
    expect(existsSync(summaryFile())).toBe(true);
    expect(summary.eventsTotal).toBe(1);
    expect(summary.liveSessionId).toBe(LSID);
    expect(summary.rawBytesTotal).toBe(1000);
    expect(summary.secretsRedactedTotal).toBe(2);
    expect(summary.chunksStoredTotal).toBe(3);
  });

  it("folds two events and recomputes savingRatio from totals", () => {
    appendOverlayEvent({
      store,
      event: makeEvent({ id: "e1" }),
      secretsRedacted: 1,
      chunksStored: 0,
    });
    const summary = appendOverlayEvent({
      store,
      event: makeEvent({ id: "e2", rawBytes: 3000, returnedBytes: 600, bytesSaved: 2400 }),
      secretsRedacted: 0,
      chunksStored: 4,
    });
    expect(summary.eventsTotal).toBe(2);
    expect(summary.rawBytesTotal).toBe(4000);
    expect(summary.bytesSavedTotal).toBe(3200);
    expect(summary.savingRatio).toBeCloseTo(3200 / 4000);
  });
});

describe("readOverlaySummary / readOverlayEvents", () => {
  it("returns the rolled-up totals and appended events", () => {
    appendOverlayEvent({
      store,
      event: makeEvent({ id: "e1" }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    appendOverlayEvent({
      store,
      event: makeEvent({ id: "e2" }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(readOverlaySummary(store, WK, LSID)?.eventsTotal).toBe(2);
    const events = readOverlayEvents(store, WK, LSID);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("missing summary -> null and missing events -> []", () => {
    expect(readOverlaySummary(store, WK, LSID)).toBeNull();
    expect(readOverlayEvents(store, WK, LSID)).toEqual([]);
  });

  it("isolates two liveSessionIds in the same workspace", () => {
    appendOverlayEvent({
      store,
      event: makeEvent({ id: "e1" }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    const other = "22222222-2222-4222-8222-222222222222";
    expect(readOverlaySummary(store, WK, other)).toBeNull();
  });
});

describe("resetOverlayOnDisable", () => {
  it("zeroes the summary", () => {
    appendOverlayEvent({ store, event: makeEvent(), secretsRedacted: 5, chunksStored: 1 });
    const zeroed = resetOverlayOnDisable(store, WK, LSID);
    expect(zeroed.eventsTotal).toBe(0);
    expect(zeroed.rawBytesTotal).toBe(0);
    expect(zeroed.secretsRedactedTotal).toBe(0);
    expect(readOverlaySummary(store, WK, LSID)?.eventsTotal).toBe(0);
  });
});

describe("overlay event audit log", () => {
  it("terminates each appended line with a newline", () => {
    appendOverlayEvent({
      store,
      event: makeEvent({ id: "e1" }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    const raw = readFileSync(eventFile(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

describe("appendOverlayEvent — origin exclusion (LD8 honesty)", () => {
  it("appends origin rows to the JSONL but keeps them out of the summary", () => {
    const plain = appendOverlayEvent({
      store,
      event: makeEvent({ id: "evt-1", rawBytes: 1000, returnedBytes: 200, bytesSaved: 800 }),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    expect(plain.eventsTotal).toBe(1);
    expect(plain.rawBytesTotal).toBe(1000);

    const rewrite = appendOverlayEvent({
      store,
      event: makeEvent({
        id: "evt-2",
        origin: "exec-rewrite",
        rawBytes: 90_000,
        returnedBytes: 12_000,
        bytesSaved: 78_000,
      }),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    // Summary unchanged — full-raw-basis rows never fold into PostToolUse totals.
    expect(rewrite.eventsTotal).toBe(1);
    expect(rewrite.rawBytesTotal).toBe(1000);
    expect(rewrite.bytesSavedTotal).toBe(800);
    // The JSONL keeps the row for later origin-aware analysis.
    expect(readOverlayEvents(store, WK, LSID)).toHaveLength(2);
  });

  it("rebuilds the summary without origin rows", async () => {
    appendOverlayEvent({
      store,
      event: makeEvent({ id: "evt-1", rawBytes: 1000, returnedBytes: 200, bytesSaved: 800 }),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    appendOverlayEvent({
      store,
      event: makeEvent({
        id: "evt-2",
        origin: "exec-rewrite",
        rawBytes: 90_000,
        returnedBytes: 12_000,
        bytesSaved: 78_000,
      }),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    // Corrupt the summary to force the JSONL rebuild path.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(summaryFile(), "{ not json");
    const rebuilt = readOverlaySummary(store, WK, LSID);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt?.eventsTotal).toBe(1);
    expect(rebuilt?.rawBytesTotal).toBe(1000);
    expect(rebuilt?.bytesSavedTotal).toBe(800);
  });
});
