import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TokenSaverEvent } from "../src/event.js";
import { type StatsStore, appendEvent, readSummary, resetOnDisable } from "../src/store.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-reset-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const eventFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`);

const makeEvent = (id: string): TokenSaverEvent =>
  ({
    id,
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
  }) as TokenSaverEvent;

describe("resetOnDisable (spec §13c)", () => {
  beforeEach(() => {
    appendEvent({ store, event: makeEvent("e1"), secretsRedacted: 2, chunksStored: 3 });
    appendEvent({ store, event: makeEvent("e2"), secretsRedacted: 1, chunksStored: 1 });
  });

  it("preserves the events JSONL", () => {
    resetOnDisable(store, PROJECT_ID, SESSION_ID);
    expect(existsSync(eventFile())).toBe(true);
    const lines = readFileSync(eventFile(), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it("zeroes all summary totals", () => {
    const zeroed = resetOnDisable(store, PROJECT_ID, SESSION_ID);
    expect(zeroed.eventsTotal).toBe(0);
    expect(zeroed.rawBytesTotal).toBe(0);
    expect(zeroed.returnedBytesTotal).toBe(0);
    expect(zeroed.bytesSavedTotal).toBe(0);
    expect(zeroed.secretsRedactedTotal).toBe(0);
    expect(zeroed.chunksStoredTotal).toBe(0);
    expect(zeroed.savingRatio).toBe(0);
  });

  it("refreshes updatedAt to an ISO-8601 offset timestamp", () => {
    const zeroed = resetOnDisable(store, PROJECT_ID, SESSION_ID);
    expect(() => new Date(zeroed.updatedAt).toISOString()).not.toThrow();
  });

  it("persists the zeroed summary to disk", () => {
    resetOnDisable(store, PROJECT_ID, SESSION_ID);
    const read = readSummary(store, PROJECT_ID, SESSION_ID);
    expect(read?.eventsTotal).toBe(0);
  });
});
