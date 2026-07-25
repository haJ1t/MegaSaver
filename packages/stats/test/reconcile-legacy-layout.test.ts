import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayTokenSaverEvent, TokenSaverEvent } from "../src/event.js";
import { appendHandoffEvent } from "../src/handoff-event.js";
import {
  type StatsStore,
  appendEvent,
  appendOverlayEvent,
  readSummary,
  reconcileOverlaySummaries,
} from "../src/store.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;
const WORKSPACE_KEY = "0123456789abcdef";
const LIVE_SESSION_ID = "live-1";

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-reconcile-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const legacySummaryFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.json`);

const legacyEvent = (): TokenSaverEvent =>
  ({
    id: "evt-1",
    sessionId: SESSION_ID,
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

const overlayEvent = (id: string): OverlayTokenSaverEvent => ({
  id,
  liveSessionId: LIVE_SESSION_ID,
  workspaceKey: WORKSPACE_KEY,
  createdAt: "2026-07-25T12:00:00.000Z",
  sourceKind: "command",
  label: "echo",
  rawBytes: 1000,
  returnedBytes: 100,
  bytesSaved: 900,
  savingRatio: 0.9,
  summary: "s",
  mode: "balanced",
});

describe("reconcileOverlaySummaries only touches overlay workspaces", () => {
  it("leaves a legacy registry-session summary intact", () => {
    appendEvent({ store, event: legacyEvent(), secretsRedacted: 2, chunksStored: 3 });
    const before = readFileSync(legacySummaryFile(), "utf8");

    expect(reconcileOverlaySummaries(store)).toBe(0);

    expect(readFileSync(legacySummaryFile(), "utf8")).toBe(before);
    const summary = readSummary(store, PROJECT_ID, SESSION_ID);
    expect(summary?.bytesSavedTotal).toBe(9000);
    expect(summary?.eventsTotal).toBe(1);
  });

  it("keeps a registry session appendable after a reconcile sweep", () => {
    appendEvent({ store, event: legacyEvent(), secretsRedacted: 0, chunksStored: 0 });
    reconcileOverlaySummaries(store);

    const next = appendEvent({
      store,
      event: { ...legacyEvent(), id: "evt-2" },
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(next.eventsTotal).toBe(2);
    expect(next.bytesSavedTotal).toBe(18_000);
  });

  it("does not fabricate a summary from a non-session ledger", () => {
    appendHandoffEvent(store, {
      id: "h1",
      projectId: PROJECT_ID,
      kind: "pack",
      targetAgent: "codex",
      memories: 1,
      failures: 0,
      redactionFindings: 0,
      createdAt: "2026-07-25T12:00:00.000Z",
    });

    expect(reconcileOverlaySummaries(store)).toBe(0);
    expect(existsSync(join(root, "stats", PROJECT_ID, "handoff.json"))).toBe(false);
  });

  it("still repairs a lagging overlay summary in the same store", () => {
    appendEvent({ store, event: legacyEvent(), secretsRedacted: 0, chunksStored: 0 });
    appendOverlayEvent({
      store,
      event: overlayEvent("e1"),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    appendFileSync(
      join(root, "stats", WORKSPACE_KEY, `${LIVE_SESSION_ID}.events.jsonl`),
      `${JSON.stringify(overlayEvent("e2"))}\n`,
    );

    expect(reconcileOverlaySummaries(store)).toBe(1);
    const repaired = JSON.parse(
      readFileSync(join(root, "stats", WORKSPACE_KEY, `${LIVE_SESSION_ID}.json`), "utf8"),
    );
    expect(repaired.eventsTotal).toBe(2);
    expect(readSummary(store, PROJECT_ID, SESSION_ID)?.bytesSavedTotal).toBe(9000);
  });
});
