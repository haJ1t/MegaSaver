import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
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
import { assertSafeSegment, isSafeSegment } from "./safe-segment.js";
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
  // Both keys are interpolated into the path — guard every caller (append, read,
  // reset) here so a `..` / `/` segment can never escape the store root.
  assertSafeSegment(workspaceKey);
  assertSafeSegment(liveSessionId);
  return join(store.root, "stats", workspaceKey, `${liveSessionId}.json`);
}

function overlayEventsPath(store: StatsStore, workspaceKey: string, liveSessionId: string): string {
  assertSafeSegment(workspaceKey);
  assertSafeSegment(liveSessionId);
  return join(store.root, "stats", workspaceKey, `${liveSessionId}.events.jsonl`);
}

function loadOverlaySummaryStrict(path: string): OverlaySessionTokenSaverStats | null {
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

// E24 self-heal: rebuild the summary from the corruption-tolerant JSONL reader
// and persist it. secretsRedactedTotal / chunksStoredTotal cannot be recovered
// from events — events carry neither — so the repair trades those two counters
// for liveness (rebuilt as 0). A missing events file rebuilds to an empty
// summary (readOverlayEvents returns []), never a throw.
export function rebuildOverlaySummaryFromEvents(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
  nowIso: string = new Date().toISOString(),
): OverlaySessionTokenSaverStats {
  const events = readOverlayEvents(store, workspaceKey, liveSessionId);
  let eventsTotal = 0;
  let rawBytesTotal = 0;
  let returnedBytesTotal = 0;
  let bytesSavedTotal = 0;
  for (const event of events) {
    eventsTotal += 1;
    rawBytesTotal += event.rawBytes;
    returnedBytesTotal += event.returnedBytes;
    bytesSavedTotal += event.bytesSaved;
  }
  const rebuilt: OverlaySessionTokenSaverStats = {
    liveSessionId,
    eventsTotal,
    rawBytesTotal,
    returnedBytesTotal,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: nowIso,
    rebuiltAt: nowIso,
  };
  atomicWriteFile(overlaySummaryPath(store, workspaceKey, liveSessionId), JSON.stringify(rebuilt));
  return rebuilt;
}

// If the REBUILD itself fails, keep the original store_corrupt posture.
function rebuildGuarded(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats {
  try {
    return rebuildOverlaySummaryFromEvents(store, workspaceKey, liveSessionId);
  } catch {
    throw new StatsError("store_corrupt");
  }
}

// Self-healing read: repair-on-read is by design, so this WRITES on a corrupt
// summary (atomicWriteFile). Non-corrupt errors still propagate.
function loadOverlaySummarySelfHealing(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
): OverlaySessionTokenSaverStats | null {
  try {
    return loadOverlaySummaryStrict(overlaySummaryPath(store, workspaceKey, liveSessionId));
  } catch (error) {
    if (!(error instanceof StatsError) || error.code !== "store_corrupt") throw error;
    return rebuildGuarded(store, workspaceKey, liveSessionId);
  }
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

  let prior: OverlaySessionTokenSaverStats | null;
  try {
    prior = loadOverlaySummaryStrict(summary);
  } catch (error) {
    if (!(error instanceof StatsError) || error.code !== "store_corrupt") throw error;
    // E24: corrupt summary — the JSONL (which already contains the line
    // appended above) is authoritative. The rebuild therefore covers this
    // event too; do NOT accumulate on top of it.
    return rebuildGuarded(store, event.workspaceKey, event.liveSessionId);
  }
  const base = prior ?? emptyOverlaySummary(event.liveSessionId);
  const rawBytesTotal = base.rawBytesTotal + event.rawBytes;
  const bytesSavedTotal = base.bytesSavedTotal + event.bytesSaved;
  const next: OverlaySessionTokenSaverStats = {
    liveSessionId: event.liveSessionId,
    eventsTotal: base.eventsTotal + 1,
    rawBytesTotal,
    returnedBytesTotal: base.returnedBytesTotal + event.returnedBytes,
    bytesSavedTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: base.secretsRedactedTotal + secretsRedacted,
    chunksStoredTotal: base.chunksStoredTotal + chunksStored,
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
  return loadOverlaySummarySelfHealing(store, workspaceKey, liveSessionId);
}

// A CLI command receives only a liveSessionId (never a workspaceKey), so to
// resolve an overlay summary it must scan every workspace under stats/. Best-
// effort: a missing stats/ dir or a corrupt per-workspace file is skipped, not
// fatal. Returns the lexicographically-smallest workspaceKey match for a
// deterministic result when the same id somehow appears in two workspaces.
export function readOverlaySummaryAnyWorkspace(
  store: StatsStore,
  liveSessionId: string,
): { workspaceKey: string; summary: OverlaySessionTokenSaverStats } | null {
  let entries: string[];
  try {
    entries = readdirSync(join(store.root, "stats"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }

  for (const workspaceKey of entries) {
    if (!isSafeSegment(workspaceKey)) {
      continue;
    }
    let summary: OverlaySessionTokenSaverStats | null;
    try {
      summary = readOverlaySummary(store, workspaceKey, liveSessionId);
    } catch {
      continue;
    }
    if (summary) {
      return { workspaceKey, summary };
    }
  }
  return null;
}

export type WorkspaceTokenSaverTotals = {
  workspaceKey: string;
  sessionsCount: number;
  eventsTotal: number;
  rawBytesTotal: number;
  returnedBytesTotal: number;
  bytesSavedTotal: number;
  savingRatio: number;
  secretsRedactedTotal: number;
  chunksStoredTotal: number;
  latestUpdatedAt: string | null;
};

// Overlay stats are keyed per rotated liveSessionId, so one conversation
// scatters across many summary files. Sum every valid summary under a
// workspace. Files are schema-validated (not filename-globbed): sibling
// settings/intent/workspace files and *.events.jsonl parse-fail and are
// dropped. Best-effort: a missing dir or a corrupt file is skipped, not fatal.
export function readWorkspaceTokenSaverTotals(
  store: StatsStore,
  workspaceKey: string,
): WorkspaceTokenSaverTotals | null {
  assertSafeSegment(workspaceKey);
  let entries: string[];
  try {
    entries = readdirSync(join(store.root, "stats", workspaceKey));
  } catch {
    return null;
  }

  const totals: WorkspaceTokenSaverTotals = {
    workspaceKey,
    sessionsCount: 0,
    eventsTotal: 0,
    rawBytesTotal: 0,
    returnedBytesTotal: 0,
    bytesSavedTotal: 0,
    savingRatio: 0,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    latestUpdatedAt: null,
  };

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(store.root, "stats", workspaceKey, entry), "utf8"));
    } catch {
      continue;
    }
    const parsed = overlaySessionTokenSaverStatsSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    const summary = parsed.data;
    totals.sessionsCount += 1;
    totals.eventsTotal += summary.eventsTotal;
    totals.rawBytesTotal += summary.rawBytesTotal;
    totals.returnedBytesTotal += summary.returnedBytesTotal;
    totals.bytesSavedTotal += summary.bytesSavedTotal;
    totals.secretsRedactedTotal += summary.secretsRedactedTotal;
    totals.chunksStoredTotal += summary.chunksStoredTotal;
    // Compare parsed epoch ms, not raw ISO strings: an ISO timestamp with a
    // non-UTC offset (e.g. +02:00) can sort lexically opposite to its true
    // chronology. Store the original ISO string, pick by chronological order.
    if (
      totals.latestUpdatedAt === null ||
      Date.parse(summary.updatedAt) > Date.parse(totals.latestUpdatedAt)
    ) {
      totals.latestUpdatedAt = summary.updatedAt;
    }
  }

  if (totals.sessionsCount === 0) {
    return null;
  }

  totals.savingRatio =
    totals.rawBytesTotal === 0 ? 0 : totals.bytesSavedTotal / totals.rawBytesTotal;
  return totals;
}

export type AllWorkspaceTokenSaverTotals = {
  bytesSavedTotal: number;
  sessionsCount: number;
  savingRatio: number;
  workspaceCount: number;
};

// Cumulative token-saver totals across EVERY workspace under the stats store —
// the source for the GUI home headline. Reuses readWorkspaceTokenSaverTotals
// per workspace, then blends the ratio from summed raw+saved bytes (both are
// retained per workspace) rather than averaging per-workspace ratios. Best-
// effort: a missing stats/ dir yields zeros; an unreadable workspace is skipped.
export function readAllWorkspaceTokenSaverTotals(store: StatsStore): AllWorkspaceTokenSaverTotals {
  let entries: string[];
  try {
    entries = readdirSync(join(store.root, "stats"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { bytesSavedTotal: 0, sessionsCount: 0, savingRatio: 0, workspaceCount: 0 };
  }

  let bytesSavedTotal = 0;
  let rawBytesTotal = 0;
  let sessionsCount = 0;
  let workspaceCount = 0;

  for (const workspaceKey of entries) {
    if (!isSafeSegment(workspaceKey)) {
      continue;
    }
    let totals: WorkspaceTokenSaverTotals | null;
    try {
      totals = readWorkspaceTokenSaverTotals(store, workspaceKey);
    } catch {
      continue;
    }
    if (totals === null) {
      continue;
    }
    workspaceCount += 1;
    sessionsCount += totals.sessionsCount;
    bytesSavedTotal += totals.bytesSavedTotal;
    rawBytesTotal += totals.rawBytesTotal;
  }

  return {
    bytesSavedTotal,
    sessionsCount,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    workspaceCount,
  };
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
