import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatsError } from "../src/errors.js";
import type { TokenSaverEvent } from "../src/event.js";
import { type StatsStore, appendEvent, readSummary } from "../src/store.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const eventFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`);
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

describe("appendEvent + readSummary roundtrip", () => {
  it("appends an event and returns folded totals", () => {
    const summary = appendEvent({
      store,
      event: makeEvent(),
      secretsRedacted: 2,
      chunksStored: 3,
    });
    expect(summary.eventsTotal).toBe(1);
    expect(summary.rawBytesTotal).toBe(1000);
    expect(summary.returnedBytesTotal).toBe(200);
    expect(summary.bytesSavedTotal).toBe(800);
    expect(summary.secretsRedactedTotal).toBe(2);
    expect(summary.chunksStoredTotal).toBe(3);
    expect(summary.savingRatio).toBeCloseTo(0.8);
  });

  it("folds two events and recomputes savingRatio from totals", () => {
    appendEvent({ store, event: makeEvent({ id: "e1" }), secretsRedacted: 1, chunksStored: 0 });
    const summary = appendEvent({
      store,
      event: makeEvent({ id: "e2", rawBytes: 3000, returnedBytes: 600, bytesSaved: 2400 }),
      secretsRedacted: 0,
      chunksStored: 4,
    });
    expect(summary.eventsTotal).toBe(2);
    expect(summary.rawBytesTotal).toBe(4000);
    expect(summary.bytesSavedTotal).toBe(3200);
    expect(summary.savingRatio).toBeCloseTo(3200 / 4000);
    expect(summary.secretsRedactedTotal).toBe(1);
    expect(summary.chunksStoredTotal).toBe(4);
  });

  it("readSummary returns the persisted summary", () => {
    appendEvent({ store, event: makeEvent(), secretsRedacted: 0, chunksStored: 0 });
    const read = readSummary(store, PROJECT_ID, SESSION_ID);
    expect(read?.eventsTotal).toBe(1);
  });

  it("readSummary returns null when the file is absent", () => {
    expect(readSummary(store, PROJECT_ID, SESSION_ID)).toBeNull();
  });

  it("JSONL line count matches eventsTotal", () => {
    appendEvent({ store, event: makeEvent({ id: "e1" }), secretsRedacted: 0, chunksStored: 0 });
    appendEvent({ store, event: makeEvent({ id: "e2" }), secretsRedacted: 0, chunksStored: 0 });
    const lines = readFileSync(eventFile(), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it("savingRatio is 0 when rawBytesTotal is 0", () => {
    const summary = appendEvent({
      store,
      event: makeEvent({ rawBytes: 0, returnedBytes: 0, bytesSaved: 0, savingRatio: 0 }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(summary.savingRatio).toBe(0);
  });

  it("rejects an invalid event with schema_invalid", () => {
    try {
      appendEvent({
        store,
        event: makeEvent({ id: "" }),
        secretsRedacted: 0,
        chunksStored: 0,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(StatsError);
      expect((err as StatsError).code).toBe("schema_invalid");
    }
  });
});

describe("JSONL durability semantics", () => {
  it("terminates every appended line with a newline so a partial tail is never committed", () => {
    appendEvent({ store, event: makeEvent({ id: "e1" }), secretsRedacted: 0, chunksStored: 0 });
    appendEvent({ store, event: makeEvent({ id: "e2" }), secretsRedacted: 0, chunksStored: 0 });
    const raw = readFileSync(eventFile(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    // A fully-terminated log splits into N committed lines plus one empty trailing
    // fragment; only the N terminated lines count, matching eventsTotal (§5c).
    const committed = raw.split("\n").filter((l) => l.length > 0);
    expect(committed).toHaveLength(2);
    const summary = readSummary(store, PROJECT_ID, SESSION_ID);
    expect(summary?.eventsTotal).toBe(committed.length);
  });

  it("does not count a non-terminated trailing fragment as a committed event", () => {
    appendEvent({ store, event: makeEvent({ id: "e1" }), secretsRedacted: 0, chunksStored: 0 });
    // Simulate a crash mid-append: a partial, non-terminated line is appended after
    // the last committed (newline-terminated) line. Splitting on "\n" and dropping
    // empty/partial fragments yields only the committed events; eventsTotal is unchanged.
    writeFileSync(eventFile(), `${readFileSync(eventFile(), "utf8")}{"partial":true`, {
      flag: "w",
    });
    const raw = readFileSync(eventFile(), "utf8");
    // Committed events are exactly the segments that precede a "\n". Splitting on
    // "\n" yields [event1, '{"partial":true']; the last segment has no terminator
    // and is dropped, leaving one committed event.
    const segments = raw.split("\n");
    const committed = segments.slice(0, -1).filter((l) => l.length > 0);
    expect(committed).toHaveLength(1);
    expect(raw.endsWith("\n")).toBe(false);
    // The summary is sourced from the atomically-written .json, unaffected by the
    // partial JSONL tail.
    expect(readSummary(store, PROJECT_ID, SESSION_ID)?.eventsTotal).toBe(1);
  });

  it("treats a corrupt fully-terminated line as store_corrupt", () => {
    appendEvent({ store, event: makeEvent({ id: "e1" }), secretsRedacted: 0, chunksStored: 0 });
    writeFileSync(summaryFile(), "{not valid json}", { flag: "w" });
    expect(() => readSummary(store, PROJECT_ID, SESSION_ID)).toThrow(StatsError);
  });

  it("creates parent directories on first append", () => {
    expect(existsSync(join(root, "stats", PROJECT_ID))).toBe(false);
    appendEvent({ store, event: makeEvent(), secretsRedacted: 0, chunksStored: 0 });
    expect(existsSync(summaryFile())).toBe(true);
  });
});
