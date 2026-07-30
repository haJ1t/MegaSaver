import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import {
  type StatsStore,
  appendOverlayEvent,
  hasOverlayEvent,
  readOverlaySummary,
} from "../src/store.js";

const WK = "0123456789abcdef";
const LSID = "11111111-1111-4111-8111-111111111111";

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-idem-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const eventFile = () => join(root, "stats", WK, `${LSID}.events.jsonl`);

const makeEvent = (overrides: Partial<OverlayTokenSaverEvent> = {}): OverlayTokenSaverEvent =>
  ({
    id: "ove-deadbeefdeadbeefdeadbeefdeadbeef",
    workspaceKey: WK,
    liveSessionId: LSID,
    createdAt: "2026-07-31T12:00:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    deltaBytes: 800,
    savingRatio: 0.8,
    summary: "s",
    mode: "balanced",
    ...overrides,
  }) as OverlayTokenSaverEvent;

describe("appendOverlayEvent — B11 same-identity idempotency", () => {
  it("a second append with the same id is a no-op, not an error", () => {
    appendOverlayEvent({ store, event: makeEvent(), secretsRedacted: 0, chunksStored: 1 });
    const summary = appendOverlayEvent({
      // The daemon-write-then-client-timeout race replays the SAME compression
      // with a fresh createdAt; only the identity may decide.
      store,
      event: makeEvent({ createdAt: "2026-07-31T12:00:01.500Z" }),
      secretsRedacted: 0,
      chunksStored: 1,
    });

    const lines = readFileSync(eventFile(), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(summary.eventsTotal).toBe(1);
    expect(summary.bytesSavedTotal).toBe(800);
    expect(summary.deltaBytesTotal).toBe(800);
    expect(readOverlaySummary(store, WK, LSID)?.eventsTotal).toBe(1);
  });

  it("a different id still appends normally", () => {
    appendOverlayEvent({ store, event: makeEvent(), secretsRedacted: 0, chunksStored: 1 });
    const summary = appendOverlayEvent({
      store,
      event: makeEvent({ id: "ove-0123456789abcdef0123456789abcdef" }),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    expect(summary.eventsTotal).toBe(2);
    expect(summary.bytesSavedTotal).toBe(1600);
  });
});

describe("hasOverlayEvent", () => {
  it("reports presence by id, false for a missing id or missing file", () => {
    expect(hasOverlayEvent(store, WK, LSID, "ove-deadbeefdeadbeefdeadbeefdeadbeef")).toBe(false);
    appendOverlayEvent({ store, event: makeEvent(), secretsRedacted: 0, chunksStored: 1 });
    expect(hasOverlayEvent(store, WK, LSID, "ove-deadbeefdeadbeefdeadbeefdeadbeef")).toBe(true);
    expect(hasOverlayEvent(store, WK, LSID, "ove-0123456789abcdef0123456789abcdef")).toBe(false);
  });
});
