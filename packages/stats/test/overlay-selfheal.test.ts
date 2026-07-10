import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import {
  appendOverlayEvent,
  readOverlaySummary,
  rebuildOverlaySummaryFromEvents,
} from "../src/store.js";

const WK = "wk-selfheal";
const ID = "live-selfheal-1";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-stats-heal-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function event(id: string, rawBytes: number): OverlayTokenSaverEvent {
  return {
    id,
    liveSessionId: ID,
    workspaceKey: WK,
    createdAt: "2026-07-10T00:00:00.000Z",
    sourceKind: "command",
    label: "echo",
    rawBytes,
    returnedBytes: 100,
    bytesSaved: rawBytes - 100,
    savingRatio: (rawBytes - 100) / rawBytes,
    summary: "s",
    mode: "balanced",
  };
}

function corruptSummary(): string {
  const p = join(root, "stats", WK, `${ID}.json`);
  mkdirSync(join(root, "stats", WK), { recursive: true });
  writeFileSync(p, "{{{ not json");
  return p;
}

describe("E24 self-healing overlay summaries", () => {
  it("readOverlaySummary rebuilds a corrupt summary from the events JSONL", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1", 1000),
      secretsRedacted: 1,
      chunksStored: 1,
    });
    appendOverlayEvent({
      store: { root },
      event: event("e2", 2000),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    corruptSummary();
    const s = readOverlaySummary({ root }, WK, ID);
    expect(s?.eventsTotal).toBe(2);
    expect(s?.rawBytesTotal).toBe(3000);
    expect(s?.bytesSavedTotal).toBe(2800);
    expect(s?.rebuiltAt).toBeDefined();
    // the repair trades the two event-less counters for liveness:
    expect(s?.secretsRedactedTotal).toBe(0);
    expect(s?.chunksStoredTotal).toBe(0);
  });

  it("appendOverlayEvent survives a corrupt summary and counts prior events + the new one", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1", 1000),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    corruptSummary();
    const next = appendOverlayEvent({
      store: { root },
      event: event("e2", 2000),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    expect(next.eventsTotal).toBe(2);
    expect(next.rawBytesTotal).toBe(3000);
    expect(next.rebuiltAt).toBeDefined();
  });

  it("corrupt summary + missing events file rebuilds to an EMPTY summary instead of throwing", () => {
    corruptSummary(); // no .events.jsonl exists next to it
    const s = readOverlaySummary({ root }, WK, ID);
    expect(s?.eventsTotal).toBe(0);
    expect(s?.rawBytesTotal).toBe(0);
    expect(s?.rebuiltAt).toBeDefined();
  });

  it("rebuildOverlaySummaryFromEvents persists the rebuilt summary", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1", 1000),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    corruptSummary();
    const rebuilt = rebuildOverlaySummaryFromEvents({ root }, WK, ID, "2026-07-10T12:00:00.000Z");
    expect(rebuilt.rebuiltAt).toBe("2026-07-10T12:00:00.000Z");
    expect(rebuilt.updatedAt).toBe("2026-07-10T12:00:00.000Z");
    const onDisk = JSON.parse(readFileSync(join(root, "stats", WK, `${ID}.json`), "utf8"));
    expect(onDisk.eventsTotal).toBe(1);
    expect(onDisk.rebuiltAt).toBe("2026-07-10T12:00:00.000Z");
  });
});
