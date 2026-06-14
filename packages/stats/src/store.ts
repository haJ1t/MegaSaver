import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { atomicWriteFile } from "./atomic-write.js";
import { StatsError } from "./errors.js";
import {
  type OverlayTokenSaverEvent,
  type TokenSaverEvent,
  overlayTokenSaverEventSchema,
  tokenSaverEventSchema,
} from "./event.js";
import {
  type OverlaySessionTokenSaverStats,
  type SessionTokenSaverStats,
  overlaySessionTokenSaverStatsSchema,
  sessionTokenSaverStatsSchema,
} from "./summary.js";

export type StatsStore = { root: string };

export type AppendEventInput = {
  store: StatsStore;
  event: TokenSaverEvent;
  secretsRedacted: number;
  chunksStored: number;
};

function summaryPath(store: StatsStore, projectId: ProjectId, sessionId: SessionId): string {
  return join(store.root, "stats", projectId, `${sessionId}.json`);
}

function eventsPath(store: StatsStore, projectId: ProjectId, sessionId: SessionId): string {
  return join(store.root, "stats", projectId, `${sessionId}.events.jsonl`);
}

function loadSummary(path: string): SessionTokenSaverStats | null {
  if (!existsSync(path)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new StatsError("store_corrupt");
  }
  const parsed = sessionTokenSaverStatsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StatsError("store_corrupt");
  }
  return parsed.data;
}

function emptySummary(sessionId: SessionId): SessionTokenSaverStats {
  return {
    sessionId,
    eventsTotal: 0,
    rawBytesTotal: 0,
    returnedBytesTotal: 0,
    bytesSavedTotal: 0,
    savingRatio: 0,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function appendEvent(input: AppendEventInput): SessionTokenSaverStats {
  const { store, secretsRedacted, chunksStored } = input;
  const parsed = tokenSaverEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const event = parsed.data;

  const events = eventsPath(store, event.projectId, event.sessionId);
  const summary = summaryPath(store, event.projectId, event.sessionId);

  mkdirSync(dirname(events), { recursive: true });
  appendFileSync(events, `${JSON.stringify(event)}\n`);

  const prior = loadSummary(summary) ?? emptySummary(event.sessionId);
  const rawBytesTotal = prior.rawBytesTotal + event.rawBytes;
  const bytesSavedTotal = prior.bytesSavedTotal + event.bytesSaved;
  const next: SessionTokenSaverStats = {
    sessionId: event.sessionId,
    eventsTotal: prior.eventsTotal + 1,
    rawBytesTotal,
    returnedBytesTotal: prior.returnedBytesTotal + event.returnedBytes,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: prior.secretsRedactedTotal + secretsRedacted,
    chunksStoredTotal: prior.chunksStoredTotal + chunksStored,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteFile(summary, JSON.stringify(next));
  return next;
}

export function readSummary(
  store: StatsStore,
  projectId: ProjectId,
  sessionId: SessionId,
): SessionTokenSaverStats | null {
  return loadSummary(summaryPath(store, projectId, sessionId));
}

// Read the per-call audit trail (one TokenSaverEvent per line). Missing file
// -> []. Malformed lines are skipped (a crashed append can leave a partial
// last line) so adoption metrics never crash on a corrupt log.
export function readEvents(
  store: StatsStore,
  projectId: ProjectId,
  sessionId: SessionId,
): TokenSaverEvent[] {
  const path = eventsPath(store, projectId, sessionId);
  if (!existsSync(path)) {
    return [];
  }
  const events: TokenSaverEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = tokenSaverEventSchema.safeParse(raw);
    if (parsed.success) {
      events.push(parsed.data);
    }
  }
  return events;
}

export function resetOnDisable(
  store: StatsStore,
  projectId: ProjectId,
  sessionId: SessionId,
): SessionTokenSaverStats {
  const zeroed = emptySummary(sessionId);
  atomicWriteFile(summaryPath(store, projectId, sessionId), JSON.stringify(zeroed));
  return zeroed;
}

// F4 live-first overlay: same fold semantics keyed by (workspaceKey, liveSessionId).
export type AppendOverlayEventInput = {
  store: StatsStore;
  event: OverlayTokenSaverEvent;
  secretsRedacted: number;
  chunksStored: number;
};

function overlaySummaryPath(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): string {
  return join(store.root, "stats", workspaceKey, `${liveSessionId}.json`);
}

function overlayEventsPath(store: StatsStore, workspaceKey: string, liveSessionId: string): string {
  return join(store.root, "stats", workspaceKey, `${liveSessionId}.events.jsonl`);
}

function loadOverlaySummary(path: string): OverlaySessionTokenSaverStats | null {
  if (!existsSync(path)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new StatsError("store_corrupt");
  }
  const parsed = overlaySessionTokenSaverStatsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StatsError("store_corrupt");
  }
  return parsed.data;
}

function emptyOverlaySummary(liveSessionId: string): OverlaySessionTokenSaverStats {
  return {
    liveSessionId,
    eventsTotal: 0,
    rawBytesTotal: 0,
    returnedBytesTotal: 0,
    bytesSavedTotal: 0,
    savingRatio: 0,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function appendOverlayEvent(input: AppendOverlayEventInput): OverlaySessionTokenSaverStats {
  const { store, secretsRedacted, chunksStored } = input;
  const parsed = overlayTokenSaverEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const event = parsed.data;

  const events = overlayEventsPath(store, event.workspaceKey, event.liveSessionId);
  const summary = overlaySummaryPath(store, event.workspaceKey, event.liveSessionId);

  mkdirSync(dirname(events), { recursive: true });
  appendFileSync(events, `${JSON.stringify(event)}\n`);

  const prior = loadOverlaySummary(summary) ?? emptyOverlaySummary(event.liveSessionId);
  const rawBytesTotal = prior.rawBytesTotal + event.rawBytes;
  const bytesSavedTotal = prior.bytesSavedTotal + event.bytesSaved;
  const next: OverlaySessionTokenSaverStats = {
    liveSessionId: event.liveSessionId,
    eventsTotal: prior.eventsTotal + 1,
    rawBytesTotal,
    returnedBytesTotal: prior.returnedBytesTotal + event.returnedBytes,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: prior.secretsRedactedTotal + secretsRedacted,
    chunksStoredTotal: prior.chunksStoredTotal + chunksStored,
    updatedAt: new Date().toISOString(),
  };

  atomicWriteFile(summary, JSON.stringify(next));
  return next;
}

export function readOverlaySummary(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats | null {
  return loadOverlaySummary(overlaySummaryPath(store, workspaceKey, liveSessionId));
}

export function readOverlayEvents(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlayTokenSaverEvent[] {
  const path = overlayEventsPath(store, workspaceKey, liveSessionId);
  if (!existsSync(path)) {
    return [];
  }
  const events: OverlayTokenSaverEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = overlayTokenSaverEventSchema.safeParse(raw);
    if (parsed.success) {
      events.push(parsed.data);
    }
  }
  return events;
}

export function resetOverlayOnDisable(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats {
  const zeroed = emptyOverlaySummary(liveSessionId);
  atomicWriteFile(overlaySummaryPath(store, workspaceKey, liveSessionId), JSON.stringify(zeroed));
  return zeroed;
}
