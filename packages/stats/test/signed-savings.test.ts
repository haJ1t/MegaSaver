import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type OverlayTokenSaverEvent,
  type TokenSaverEvent,
  deltaBytesOf,
  overlayTokenSaverEventSchema,
  tokenSaverEventSchema,
} from "../src/event.js";
import {
  overlaySessionTokenSaverStatsSchema,
  sessionTokenSaverStatsSchema,
} from "../src/summary.js";
import {
  type StatsStore,
  appendEvent,
  appendOverlayEvent,
  readOverlaySummary,
  readWorkspaceTokenSaverTotals,
  rebuildOverlaySummaryFromEvents,
} from "../src/store.js";

const WK = "0123456789abcdef";
const LSID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-signed-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const makeOverlayEvent = (overrides: Record<string, unknown> = {}): OverlayTokenSaverEvent =>
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

const makeRegistryEvent = (overrides: Record<string, unknown> = {}): TokenSaverEvent =>
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

describe("event schema: signed deltaBytes", () => {
  it("accepts a negative deltaBytes (inflation is representable)", () => {
    const r = overlayTokenSaverEventSchema.safeParse(
      makeOverlayEvent({ rawBytes: 1000, returnedBytes: 1200, bytesSaved: 0, deltaBytes: -200 }),
    );
    expect(r.success).toBe(true);
    const r2 = tokenSaverEventSchema.safeParse(
      makeRegistryEvent({ rawBytes: 1000, returnedBytes: 1200, bytesSaved: 0, deltaBytes: -200 }),
    );
    expect(r2.success).toBe(true);
  });

  it("keeps pre-B1 rows parsing: deltaBytes absent is valid", () => {
    expect(overlayTokenSaverEventSchema.safeParse(makeOverlayEvent()).success).toBe(true);
    expect(tokenSaverEventSchema.safeParse(makeRegistryEvent()).success).toBe(true);
  });

  it("rejects a non-integer deltaBytes", () => {
    expect(
      overlayTokenSaverEventSchema.safeParse(makeOverlayEvent({ deltaBytes: 1.5 })).success,
    ).toBe(false);
  });
});

describe("summary schema: signed deltaBytesTotal", () => {
  const validOverlay = {
    liveSessionId: LSID,
    eventsTotal: 2,
    rawBytesTotal: 2000,
    returnedBytesTotal: 2400,
    bytesSavedTotal: 0,
    savingRatio: 0,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: "2026-05-10T12:00:00.000Z",
  };
  const validRegistry = { ...validOverlay, sessionId: SESSION_ID };
  delete (validRegistry as Record<string, unknown>).liveSessionId;

  it("accepts a negative deltaBytesTotal", () => {
    expect(
      overlaySessionTokenSaverStatsSchema.safeParse({ ...validOverlay, deltaBytesTotal: -400 })
        .success,
    ).toBe(true);
    expect(
      sessionTokenSaverStatsSchema.safeParse({ ...validRegistry, deltaBytesTotal: -400 }).success,
    ).toBe(true);
  });

  it("keeps pre-B1 summaries parsing: deltaBytesTotal absent is valid", () => {
    expect(overlaySessionTokenSaverStatsSchema.safeParse(validOverlay).success).toBe(true);
    expect(sessionTokenSaverStatsSchema.safeParse(validRegistry).success).toBe(true);
  });
});

describe("deltaBytesOf", () => {
  it("reads the signed field when present", () => {
    expect(deltaBytesOf(makeOverlayEvent({ deltaBytes: -200 }))).toBe(-200);
  });

  it("falls back to legacy clamped bytesSaved when absent", () => {
    expect(deltaBytesOf(makeOverlayEvent({ bytesSaved: 800 }))).toBe(800);
  });
});

describe("store fold: signed aggregate", () => {
  it("an inflating overlay event produces a NEGATIVE deltaBytesTotal", () => {
    const summary = appendOverlayEvent({
      store,
      event: makeOverlayEvent({
        rawBytes: 1000,
        returnedBytes: 1200,
        bytesSaved: 0,
        savingRatio: 0,
        deltaBytes: -200,
      }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(summary.bytesSavedTotal).toBe(0);
    expect(summary.deltaBytesTotal).toBe(-200);
  });

  it("seeds a legacy summary (no deltaBytesTotal) from its bytesSavedTotal, then folds signed", () => {
    const dir = join(root, "stats", WK);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${LSID}.json`),
      JSON.stringify({
        liveSessionId: LSID,
        eventsTotal: 1,
        rawBytesTotal: 1000,
        returnedBytesTotal: 200,
        bytesSavedTotal: 800,
        savingRatio: 0.8,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 0,
        updatedAt: "2026-05-10T12:00:00.000Z",
      }),
    );
    const summary = appendOverlayEvent({
      store,
      event: makeOverlayEvent({ id: "e2", deltaBytes: -200, bytesSaved: 0, returnedBytes: 1200 }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(summary.deltaBytesTotal).toBe(600);
  });

  it("registry appendEvent folds the signed delta too", () => {
    const summary = appendEvent({
      store,
      event: makeRegistryEvent({ bytesSaved: 0, savingRatio: 0, returnedBytes: 1300, deltaBytes: -300 }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(summary.deltaBytesTotal).toBe(-300);
  });

  it("rebuild folds deltaBytes when present, legacy bytesSaved when absent", () => {
    const dir = join(root, "stats", WK);
    mkdirSync(dir, { recursive: true });
    const legacy = makeOverlayEvent({ id: "e1", bytesSaved: 800 });
    const signed = makeOverlayEvent({
      id: "e2",
      bytesSaved: 0,
      savingRatio: 0,
      returnedBytes: 1200,
      deltaBytes: -200,
    });
    writeFileSync(
      join(dir, `${LSID}.events.jsonl`),
      `${JSON.stringify(legacy)}\n${JSON.stringify(signed)}\n`,
    );
    const rebuilt = rebuildOverlaySummaryFromEvents(store, WK, LSID);
    expect(rebuilt.bytesSavedTotal).toBe(800);
    expect(rebuilt.deltaBytesTotal).toBe(600);
    expect(readOverlaySummary(store, WK, LSID)?.deltaBytesTotal).toBe(600);
  });

  it("workspace totals surface the signed aggregate", () => {
    appendOverlayEvent({
      store,
      event: makeOverlayEvent({ deltaBytes: 800 }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    appendOverlayEvent({
      store,
      event: makeOverlayEvent({
        id: "e2",
        bytesSaved: 0,
        savingRatio: 0,
        returnedBytes: 1200,
        deltaBytes: -200,
      }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    const totals = readWorkspaceTokenSaverTotals(store, WK);
    expect(totals?.deltaBytesTotal).toBe(600);
    expect(totals?.bytesSavedTotal).toBe(800);
  });

  it("legacy rows alone keep deltaBytesTotal continuous with bytesSavedTotal", () => {
    appendOverlayEvent({
      store,
      event: makeOverlayEvent({ bytesSaved: 800 }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    const raw = JSON.parse(readFileSync(join(root, "stats", WK, `${LSID}.json`), "utf8"));
    expect(raw.deltaBytesTotal).toBe(800);
  });
});
