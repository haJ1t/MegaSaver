import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ProjectId, type SessionId, workspaceKeySchema } from "@megasaver/shared";
import { withFileLock } from "@megasaver/shared/node";
import { appendPrivateLine } from "./append-line.js";
import { atomicWriteFile } from "./atomic-write.js";
import { StatsError } from "./errors.js";
import {
  type OverlayTokenSaverEvent,
  type TokenSaverEvent,
  deltaBytesOf,
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

// The pre-fix overlay GC sweep walked registry project dirs as workspaces and
// overwrote <sessionId>.json with an overlay-shaped summary. The layout
// discriminator stops new damage but leaves already-clobbered stores unreadable
// forever, so a summary that IS json yet fails the registry schema is rebuilt
// from the authoritative JSONL. A file that is not json at all is a torn write,
// not a layout mismatch — it keeps the loud store_corrupt posture, because the
// registry event carries no secretsRedacted/chunksStored and a rebuild zeroes
// those two counters.
function loadSummary(
  store: StatsStore,
  projectId: ProjectId,
  sessionId: SessionId,
): SessionTokenSaverStats | null {
  const path = summaryPath(store, projectId, sessionId);
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
    return rebuildSummaryFromEvents(store, projectId, sessionId);
  }
  return parsed.data;
}

function rebuildSummaryFromEvents(
  store: StatsStore,
  projectId: ProjectId,
  sessionId: SessionId,
): SessionTokenSaverStats {
  const rebuilt = emptySummary(sessionId);
  let deltaBytesTotal = 0;
  for (const event of readEvents(store, projectId, sessionId)) {
    rebuilt.eventsTotal += 1;
    rebuilt.rawBytesTotal += event.rawBytes;
    rebuilt.returnedBytesTotal += event.returnedBytes;
    rebuilt.bytesSavedTotal += event.bytesSaved;
    deltaBytesTotal += deltaBytesOf(event);
  }
  rebuilt.deltaBytesTotal = deltaBytesTotal;
  rebuilt.savingRatio =
    rebuilt.rawBytesTotal === 0 ? 0 : rebuilt.bytesSavedTotal / rebuilt.rawBytesTotal;
  atomicWriteFile(summaryPath(store, projectId, sessionId), JSON.stringify(rebuilt));
  return rebuilt;
}

function emptySummary(sessionId: SessionId): SessionTokenSaverStats {
  return {
    sessionId,
    eventsTotal: 0,
    rawBytesTotal: 0,
    returnedBytesTotal: 0,
    bytesSavedTotal: 0,
    deltaBytesTotal: 0,
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

  // Read BEFORE the append: a clobbered summary is repaired by folding the
  // JSONL, so this event must not already be in it when we accumulate on top.
  const prior =
    loadSummary(store, event.projectId, event.sessionId) ?? emptySummary(event.sessionId);

  appendPrivateLine(events, `${JSON.stringify(event)}\n`);

  const rawBytesTotal = prior.rawBytesTotal + event.rawBytes;
  const bytesSavedTotal = prior.bytesSavedTotal + event.bytesSaved;
  const next: SessionTokenSaverStats = {
    sessionId: event.sessionId,
    eventsTotal: prior.eventsTotal + 1,
    rawBytesTotal,
    returnedBytesTotal: prior.returnedBytesTotal + event.returnedBytes,
    bytesSavedTotal,
    // B1: seed a pre-B1 summary from its legacy clamped total, then fold the
    // signed delta — the signed aggregate stays continuous with history.
    deltaBytesTotal: (prior.deltaBytesTotal ?? prior.bytesSavedTotal) + deltaBytesOf(event),
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
  return loadSummary(store, projectId, sessionId);
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
// and persist it. secretsRedactedTotal / chunksStoredTotal: carryForward (the
// loadable prior summary's totals, which include pre-wave-5 history) is
// authoritative and WINS when present; the fold over event-carried counters
// (W5 rows) is the recovery path for a genuinely unreadable summary — better
// than zero, exact for post-wave-5 events, 0 for pre-wave-5 rows. A missing
// events file rebuilds to an empty summary (readOverlayEvents returns []),
// never a throw.
export function rebuildOverlaySummaryFromEvents(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
  nowIso: string = new Date().toISOString(),
  carryForward?: { secretsRedactedTotal: number; chunksStoredTotal: number },
): OverlaySessionTokenSaverStats {
  const events = readOverlayEvents(store, workspaceKey, liveSessionId);
  let eventsTotal = 0;
  let rawBytesTotal = 0;
  let returnedBytesTotal = 0;
  let bytesSavedTotal = 0;
  let deltaBytesTotal = 0;
  let secretsFolded = 0;
  let chunksFolded = 0;
  for (const event of events) {
    // LD8 honesty: origin-bearing rows live in the JSONL but not the summary.
    if (event.origin !== undefined) continue;
    eventsTotal += 1;
    rawBytesTotal += event.rawBytes;
    returnedBytesTotal += event.returnedBytes;
    bytesSavedTotal += event.bytesSaved;
    deltaBytesTotal += deltaBytesOf(event);
    secretsFolded += event.secretsRedacted ?? 0;
    chunksFolded += event.chunksStored ?? 0;
  }
  const rebuilt: OverlaySessionTokenSaverStats = {
    liveSessionId,
    eventsTotal,
    rawBytesTotal,
    returnedBytesTotal,
    bytesSavedTotal,
    deltaBytesTotal,
    savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
    secretsRedactedTotal: carryForward?.secretsRedactedTotal ?? secretsFolded,
    chunksStoredTotal: carryForward?.chunksStoredTotal ?? chunksFolded,
    updatedAt: nowIso,
    rebuiltAt: nowIso,
  };
  atomicWriteFile(overlaySummaryPath(store, workspaceKey, liveSessionId), JSON.stringify(rebuilt));
  return rebuilt;
}

// stats/ holds two layouts side by side: overlay dirs are 16-hex workspaceKeys
// (encodeWorkspaceKey), registry dirs are UUID project ids. Every walker that
// treats a dir as an overlay workspace goes through here — reading a registry
// dir as one destroys its legacy <sessionId>.json summaries (self-healing reads
// rewrite them as zeroed overlay summaries) and fabricates one per non-session
// *.events.jsonl ledger. Sorted for a deterministic first match.
function overlayWorkspaceKeys(store: StatsStore): string[] {
  try {
    return readdirSync(join(store.root, "stats"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => workspaceKeySchema.safeParse(name).success)
      .sort();
  } catch {
    return [];
  }
}

// E26 repair: summaries that lag their JSONL (lock-skipped updates) or fail
// schema are rebuilt. Bounded: invoked from the once-a-day GC sweep. Returns
// the number of files rebuilt. Best-effort — every per-file failure is
// swallowed so one bad workspace cannot stop the walk. The drift count uses
// SCHEMA-VALID lines (same reader the rebuild folds), so garbage lines can
// no longer trigger a rebuild every sweep; the extra parse is bounded by the
// once-a-day cadence.
export function reconcileOverlaySummaries(store: StatsStore): number {
  let rebuilt = 0;
  for (const workspaceKey of overlayWorkspaceKeys(store)) {
    let files: string[];
    try {
      files = readdirSync(join(store.root, "stats", workspaceKey));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".events.jsonl")) continue;
      const liveSessionId = file.slice(0, -".events.jsonl".length);
      if (!isSafeSegment(liveSessionId)) continue;
      try {
        // LD8 honesty: compare against AGGREGATED rows only — origin-bearing
        // rows live in the JSONL but not the summary, so counting them here
        // would mark every origin-carrying summary permanently lagging.
        const lineCount = readOverlayEvents(store, workspaceKey, liveSessionId).filter(
          (e) => e.origin === undefined,
        ).length;
        let summary: OverlaySessionTokenSaverStats | null = null;
        let corrupt = false;
        try {
          summary = loadOverlaySummaryStrict(
            overlaySummaryPath(store, workspaceKey, liveSessionId),
          );
        } catch {
          corrupt = true;
        }
        if (corrupt || summary === null || summary.eventsTotal < lineCount) {
          // A loadable-but-lagging summary still holds the event-less counters;
          // preserve them. A corrupt summary (summary === null) has no source.
          const carryForward =
            summary !== null
              ? {
                  secretsRedactedTotal: summary.secretsRedactedTotal,
                  chunksStoredTotal: summary.chunksStoredTotal,
                }
              : undefined;
          rebuildOverlaySummaryFromEvents(
            store,
            workspaceKey,
            liveSessionId,
            undefined,
            carryForward,
          );
          rebuilt += 1;
        }
      } catch {
        /* best-effort: continue the walk */
      }
    }
  }
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

// Cheap line scan (no schema parse): the append path runs inside the hook and
// only needs the id, not a validated event. Malformed lines are skipped, same
// tolerance as readOverlayEvents.
function overlayEventIdExists(path: string, id: string): boolean {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof raw === "object" && raw !== null && (raw as { id?: unknown }).id === id) {
      return true;
    }
  }
  return false;
}

// B11: writers that derive a deterministic event id (record-output) use this to
// tell a first append from a replay — e.g. to skip side effects (evidence rows)
// the duplicate append below silently absorbs.
export function hasOverlayEvent(
  store: StatsStore,
  workspaceKey: string,
  liveSessionId: string,
  eventId: string,
): boolean {
  return overlayEventIdExists(overlayEventsPath(store, workspaceKey, liveSessionId), eventId);
}

function emptyOverlaySummary(liveSessionId: string): OverlaySessionTokenSaverStats {
  return {
    liveSessionId,
    eventsTotal: 0,
    rawBytesTotal: 0,
    returnedBytesTotal: 0,
    bytesSavedTotal: 0,
    deltaBytesTotal: 0,
    savingRatio: 0,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: new Date().toISOString(),
  };
}

// `appended` tells first sight (true) from an absorbed replay (false), so a
// caller gating a side effect on first sight (record-output's evidence row)
// needs no second O(n) scan of the ledger. The summary fields stay the whole
// return for existing callers.
export type AppendOverlayEventResult = OverlaySessionTokenSaverStats & { appended: boolean };

export function appendOverlayEvent(input: AppendOverlayEventInput): AppendOverlayEventResult {
  const { store, secretsRedacted, chunksStored } = input;
  const parsed = overlayTokenSaverEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const event = parsed.data;

  const events = overlayEventsPath(store, event.workspaceKey, event.liveSessionId);
  const summary = overlaySummaryPath(store, event.workspaceKey, event.liveSessionId);

  // B11 idempotency: the daemon can finish its /excerpt write while the hook's
  // client timeout still triggers the in-process fallback for the SAME output.
  // Both writers derive the same event id, so a second append with an
  // already-recorded id is a no-op (never an error) — otherwise the savings
  // double-count and inflate the recovery-rate denominator the A4 gate reads.
  // The existence check and the append run under the SAME lock as the summary
  // fold: those two writers are concurrent by construction (two processes),
  // and an unlocked check-then-append let both miss each other's line.
  //
  // E26: parallel tool calls in one turn also race the summary
  // read-modify-write. Serialize under a short stale-aware lock: deadlineMs 50
  // (a hook must not stall the agent), staleMs 5000 (a dead writer's lock is
  // stolen).
  let appended = false;
  let next: OverlaySessionTokenSaverStats | null = null;
  // withFileLock requires the lock's parent dir; on a session's very first
  // append nothing has created it yet (that used to be appendPrivateLine's
  // side effect, which now runs inside the lock). Same owner-only mode.
  mkdirSync(dirname(summary), { recursive: true, mode: 0o700 });
  // LD8 honesty: origin-bearing (exec-rewrite) rows are appended to the
  // authoritative JSONL but EXCLUDED from the summary fold — their full-raw
  // measurement basis differs from the PostToolUse path's (the client would
  // never have paid for raw bytes past the ~30k truncation), so folding them
  // into the shared totals would inflate savings with unmeasured
  // counterfactuals. Origin-aware presentation is a follow-up wave.
  const aggregates = event.origin === undefined;
  const ran = withFileLock(`${summary}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
    if (overlayEventIdExists(events, event.id)) return;
    appendPrivateLine(events, `${JSON.stringify(event)}\n`);
    appended = true;
    let prior: OverlaySessionTokenSaverStats | null;
    try {
      prior = loadOverlaySummaryStrict(summary);
    } catch (error) {
      if (!(error instanceof StatsError) || error.code !== "store_corrupt") throw error;
      // E24: corrupt summary — the JSONL (which already contains the line
      // appended above) is authoritative. The rebuild therefore covers this
      // event too; do NOT accumulate on top of it.
      next = rebuildGuarded(store, event.workspaceKey, event.liveSessionId);
      return;
    }
    if (!aggregates) return;
    const base = prior ?? emptyOverlaySummary(event.liveSessionId);
    const rawBytesTotal = base.rawBytesTotal + event.rawBytes;
    const bytesSavedTotal = base.bytesSavedTotal + event.bytesSaved;
    next = {
      liveSessionId: event.liveSessionId,
      eventsTotal: base.eventsTotal + 1,
      rawBytesTotal,
      returnedBytesTotal: base.returnedBytesTotal + event.returnedBytes,
      bytesSavedTotal,
      // B1: same seeding rule as the registry fold — a pre-B1 summary
      // contributes its legacy clamped total, then signed deltas accumulate.
      deltaBytesTotal: (base.deltaBytesTotal ?? base.bytesSavedTotal) + deltaBytesOf(event),
      savingRatio: rawBytesTotal === 0 ? 0 : bytesSavedTotal / rawBytesTotal,
      secretsRedactedTotal: base.secretsRedactedTotal + secretsRedacted,
      chunksStoredTotal: base.chunksStoredTotal + chunksStored,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteFile(summary, JSON.stringify(next));
  });
  if (!ran) {
    // Lock contended past the deadline: degrade to the pre-lock unlocked
    // check-then-append so a genuine event is never lost (durability first —
    // dropping it would silently understate savings with nothing to repair
    // it). This narrows the dedupe race to lock-contended appends instead of
    // every append; the GC sweep's reconcileOverlaySummaries repairs the
    // summary undercount permanently.
    if (!overlayEventIdExists(events, event.id)) {
      appendPrivateLine(events, `${JSON.stringify(event)}\n`);
      appended = true;
    }
  }
  if (ran && next !== null) return { ...(next as OverlaySessionTokenSaverStats), appended };
  // Deduped, lock-contended, or corrupt-rebuild-free path: return the freshest
  // readable summary.
  return {
    ...(loadOverlaySummarySelfHealing(store, event.workspaceKey, event.liveSessionId) ??
      emptyOverlaySummary(event.liveSessionId)),
    appended,
  };
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
  for (const workspaceKey of overlayWorkspaceKeys(store)) {
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
  deltaBytesTotal: number;
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
    deltaBytesTotal: 0,
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
    // B1: a summary that never saw a signed append contributes its legacy
    // clamped total — same seeding rule as the per-session folds.
    totals.deltaBytesTotal += summary.deltaBytesTotal ?? summary.bytesSavedTotal;
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
  deltaBytesTotal: number;
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
  let bytesSavedTotal = 0;
  let deltaBytesTotal = 0;
  let rawBytesTotal = 0;
  let sessionsCount = 0;
  let workspaceCount = 0;

  for (const workspaceKey of overlayWorkspaceKeys(store)) {
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
    deltaBytesTotal += totals.deltaBytesTotal;
    rawBytesTotal += totals.rawBytesTotal;
  }

  return {
    bytesSavedTotal,
    deltaBytesTotal,
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

// Discover context reader: every session's event rows for a workspace, folded
// across files. Lenient per line (readOverlayEvents skips corrupt rows); a
// missing workspace dir is simply no events.
export function readWorkspaceOverlayEvents(
  store: StatsStore,
  workspaceKey: string,
): OverlayTokenSaverEvent[] {
  assertSafeSegment(workspaceKey);
  let entries: string[];
  try {
    entries = readdirSync(join(store.root, "stats", workspaceKey));
  } catch {
    return [];
  }
  const events: OverlayTokenSaverEvent[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".events.jsonl")) continue;
    const liveSessionId = entry.slice(0, -".events.jsonl".length);
    events.push(...readOverlayEvents(store, workspaceKey, liveSessionId));
  }
  return events;
}
