import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import { appendOverlayEvent, readOverlayEvents, reconcileOverlaySummaries } from "../src/store.js";

const WK = "wk-lock";
const ID = "live-lock-1";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-stats-lock-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function event(id: string): OverlayTokenSaverEvent {
  return {
    id,
    liveSessionId: ID,
    workspaceKey: WK,
    createdAt: "2026-07-10T00:00:00.000Z",
    sourceKind: "command",
    label: "echo",
    rawBytes: 1000,
    returnedBytes: 100,
    bytesSaved: 900,
    savingRatio: 0.9,
    summary: "s",
    mode: "balanced",
  };
}

const summaryPath = () => join(root, "stats", WK, `${ID}.json`);
const eventsPath = () => join(root, "stats", WK, `${ID}.events.jsonl`);

describe("E26 summary lock + reconciliation", () => {
  it("a contended fresh lock skips the summary write but keeps the JSONL line", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1"),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    writeFileSync(`${summaryPath()}.lock`, ""); // fresh foreign lock (mtime = now)
    const returned = appendOverlayEvent({
      store: { root },
      event: event("e2"),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    // stale summary returned (only e1 counted) — but the JSONL grew to 2 lines
    expect(returned.eventsTotal).toBe(1);
    expect(readOverlayEvents({ root }, WK, ID)).toHaveLength(2);
    expect(JSON.parse(readFileSync(summaryPath(), "utf8")).eventsTotal).toBe(1);
  });

  it("reconcileOverlaySummaries rebuilds summaries whose count lags their JSONL (two-writer lost update)", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1"),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    // simulate the lost update: writer B's line landed but its summary write lost
    appendFileSync(eventsPath(), `${JSON.stringify(event("e2"))}\n`);
    expect(JSON.parse(readFileSync(summaryPath(), "utf8")).eventsTotal).toBe(1);
    const rebuilt = reconcileOverlaySummaries({ root });
    expect(rebuilt).toBe(1);
    const after = JSON.parse(readFileSync(summaryPath(), "utf8"));
    expect(after.eventsTotal).toBe(2);
    expect(after.bytesSavedTotal).toBe(1800);
  });

  it("reconcile preserves secrets/chunks counters when the lagging summary is loadable", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1"),
      secretsRedacted: 20,
      chunksStored: 40,
    });
    // two more lines land (lost summary updates) — the summary now lags at 1
    appendFileSync(eventsPath(), `${JSON.stringify(event("e2"))}\n`);
    appendFileSync(eventsPath(), `${JSON.stringify(event("e3"))}\n`);
    expect(reconcileOverlaySummaries({ root })).toBe(1);
    const after = JSON.parse(readFileSync(summaryPath(), "utf8"));
    expect(after.eventsTotal).toBe(3);
    // events carry no secrets/chunks; the loadable prior summary must be reused
    expect(after.secretsRedactedTotal).toBe(20);
    expect(after.chunksStoredTotal).toBe(40);
  });

  it("reconcile resets secrets/chunks to 0 when the summary is corrupt (no source)", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1"),
      secretsRedacted: 7,
      chunksStored: 9,
    });
    writeFileSync(summaryPath(), "{{{ corrupt");
    expect(reconcileOverlaySummaries({ root })).toBe(1);
    const after = JSON.parse(readFileSync(summaryPath(), "utf8"));
    expect(after.eventsTotal).toBe(1);
    expect(after.secretsRedactedTotal).toBe(0);
    expect(after.chunksStoredTotal).toBe(0);
  });

  it("reconcile repairs a corrupt summary and leaves healthy ones alone", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1"),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    expect(reconcileOverlaySummaries({ root })).toBe(0); // healthy → untouched
    writeFileSync(summaryPath(), "{{{ corrupt");
    expect(reconcileOverlaySummaries({ root })).toBe(1);
    expect(JSON.parse(readFileSync(summaryPath(), "utf8")).eventsTotal).toBe(1);
  });

  it("W5: reconcile does not rebuild a healthy summary over a garbage JSONL line", () => {
    appendOverlayEvent({
      store: { root },
      event: event("e1"),
      secretsRedacted: 0,
      chunksStored: 1,
    });
    appendFileSync(eventsPath(), "{{{ torn line\n");
    // summary (eventsTotal 1) matches the 1 schema-valid line — no drift.
    expect(reconcileOverlaySummaries({ root })).toBe(0);
  });
});
