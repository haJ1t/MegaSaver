import { join } from "node:path";
import {
  type FilterOutputResult,
  finalizeReplayTrace,
  pruneTraceSessions,
  seamTraceEnabledByEnv,
  writeReplayTrace,
} from "@megasaver/output-filter";
import { type ProjectPermissions, redact, redactForLedger } from "@megasaver/policy";
import type { SessionId, TokenSaverMode } from "@megasaver/shared";
import {
  type OverlayTokenSaverEvent,
  type TokenSaverEvent,
  appendEvent,
  appendOverlayEvent,
} from "@megasaver/stats";
import { appendFirewallEvent, appendFirewallEventsFromFilter } from "./firewall-ledger.js";
import { buildOverlayHints } from "./overlay-failures.js";
import { hashContent, hashPath, loadReadIndex, recordRead } from "./read-index.js";
import {
  type LoadProjectPermissions,
  defaultNewId,
  defaultNow,
  filterRaw,
  persistChunkSet,
  persistOverlayChunkSet,
  readRaw,
  resolveEffectiveSettings,
  resolveOverlayEffectiveSettings,
  runOverlayTwoGates,
  runTwoGates,
} from "./read.js";
import type { OrchestratorRegistry } from "./registry-port.js";
import { buildSessionHints } from "./session-hints.js";
import { applyShownDedup } from "./shown-index.js";
import { messageOf, redactedCount } from "./stats-helpers.js";

// Lossless suppression marker for an unchanged re-read: zero excerpts, the prior
// chunk-set id is preserved so the agent can still expand to full content.
function unchangedResult(priorChunkSetId: string, raw: string): FilterOutputResult {
  const rawBytes = Buffer.byteLength(raw, "utf8");
  return {
    summary: "File unchanged since last read this session — expand priorChunkSetId to view.",
    excerpts: [],
    classification: { category: "unknown", confidence: 1 },
    decision: "unchanged-marker",
    compressor: "generic",
    rawBytes,
    returnedBytes: 0,
    rawTokens: 0,
    returnedTokens: 0,
    bytesSaved: rawBytes,
    savingRatio: 1,
    unchanged: { priorChunkSetId },
  };
}

export type RunOutputInput = {
  registry: OrchestratorRegistry;
  storeRoot: string;
  sessionId: SessionId;
  path: string;
  intent: string;
  now?: () => string;
  newId?: () => string;
  // Injectable project-permissions loader (default = real fs+yaml loader) so
  // tests drive absent/valid/throwing without a real file (permissions-yaml §5.2).
  loadPermissions?: LoadProjectPermissions;
  outline?: boolean;
};

export type RunOutputResult =
  | { ok: true; result: FilterOutputResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "policy_load_failed"; detail: string }
  | { ok: false; reason: "path_denied"; detail: string }
  | { ok: false; reason: "path_unsafe"; detail: string }
  | { ok: false; reason: "file_read_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };

export async function runOutputPipeline(input: RunOutputInput): Promise<RunOutputResult> {
  const resolved = resolveEffectiveSettings(input.registry, input.sessionId, input.loadPermissions);
  // Fail-closed (I3): a present-but-malformed permissions.yaml denies the read
  // here, before runTwoGates / fs.readFile — the gate is shut before IO.
  if (!resolved.ok) {
    return resolved.reason === "policy_load_failed"
      ? { ok: false, reason: "policy_load_failed", detail: resolved.detail }
      : { ok: false, reason: "session_not_found" };
  }
  const { settings } = resolved;

  const gate = runTwoGates({
    path: input.path,
    projectId: settings.projectId,
    projectRoot: settings.projectRoot,
    permissions: settings.permissions,
  });
  if (!gate.ok) {
    if (gate.code === "path_denied") {
      appendFirewallEvent(input.storeRoot, {
        at: new Date((input.now ?? defaultNow)()).toISOString(),
        kind: "blocked-read",
        detector: "secret-path",
        count: 1,
        sourcePath: redactForLedger(input.path),
        projectId: settings.projectId,
        sessionId: input.sessionId,
      });
      return { ok: false, reason: "path_denied", detail: gate.reason };
    }
    return { ok: false, reason: "path_unsafe", detail: gate.message };
  }

  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;
  const sessionDir = join(input.storeRoot, "content", settings.projectId, input.sessionId);

  const read = await readRaw(gate.absolute);
  if (!read.ok) return { ok: false, reason: "file_read_failed", detail: read.message };

  const newHash = hashContent(read.raw);
  // Outline reads key into a separate read-index slot so a prior full-read's
  // unchanged-marker can't suppress an outline request (and vice versa). The
  // \0 separator is illegal in filesystem paths on every OS, so it can never
  // collide with a real path hash — unlike `#`, which is legal on Windows NTFS.
  const pathHash = hashPath(input.outline === true ? `${gate.absolute}\0outline` : gate.absolute);
  const prior = loadReadIndex(sessionDir)[pathHash];
  if (prior !== undefined && prior.contentHash === newHash) {
    return { ok: true, result: unchangedResult(prior.chunkSetId, read.raw) };
  }

  // Failure-aware ranking: the session's prior SessionFailure signatures boost
  // any chunk that references them, mirroring the exec-command path.
  const { hints: sessionHints, warnings: hintWarnings } = buildSessionHints(
    input.registry,
    settings.projectId,
    input.sessionId,
  );
  const filteredResult = await filterRaw({
    raw: read.raw,
    path: input.path,
    intent: input.intent,
    mode: settings.mode,
    maxReturnedBytes: settings.maxReturnedBytes,
    sessionHints,
    // Trace recording is ON by default; MEGASAVER_SEAM_TRACE={false,0,off,no}
    // is the kill switch (retention prune bounds the resulting disk cost).
    recordTrace: seamTraceEnabledByEnv(),
    ...(input.outline === true ? { outline: true } : {}),
  });

  // trace + firewall are measurement data (§P2.6): trace is persisted below,
  // firewall feeds only the ledger call — both stripped from the agent-visible
  // result so they never spend the tokens they exist to measure.
  const { trace: rankingTrace, firewall: _firewall, ...filteredSansTrace } = filteredResult;
  appendFirewallEventsFromFilter(
    input.storeRoot,
    {
      at: new Date(now()).toISOString(),
      sourcePath: redactForLedger(input.path),
      projectId: settings.projectId,
      sessionId: input.sessionId,
    },
    filteredResult.firewall,
  );
  let result: FilterOutputResult = { ...filteredSansTrace };
  if (hintWarnings.length > 0) {
    result.warnings = [...(result.warnings ?? []), ...hintWarnings];
  }
  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    try {
      await persistChunkSet({
        storeRoot: input.storeRoot,
        chunkSetId,
        sessionId: input.sessionId,
        projectId: settings.projectId,
        createdAt: now(),
        path: input.path,
        result: filteredResult,
      });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
    recordRead(sessionDir, pathHash, { contentHash: newHash, chunkSetId });
    result = applyShownDedup({ result, sessionDir, chunkSetId });
  }

  // Best-effort seam measurement (§P2.6): append the ranking trace to a
  // per-session stats dir — per-session because writeReplayTrace owns the
  // fixed replay-traces.jsonl filename inside the dir it is given.
  if (rankingTrace !== undefined) {
    await writeReplayTrace(
      join(input.storeRoot, "stats", settings.projectId, `${input.sessionId}-traces`),
      finalizeReplayTrace(rankingTrace, {
        sessionId: input.sessionId,
        projectId: settings.projectId,
        toolName: "proxy_read_file",
        createdAt: now(),
        ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
        redaction: {
          redacted: (filteredResult.warnings ?? []).some((w) => w.startsWith("redacted")),
          secretsRedacted: redactedCount(filteredResult.warnings ?? []),
        },
      }),
    );
    // Bounds the only always-on new disk (tracing is on by default): cap the
    // retained trace-session dirs. Best-effort — never block or throw into the
    // response path (pruneTraceSessions swallows fs errors, but guard anyway).
    try {
      pruneTraceSessions(input.storeRoot, settings.projectId);
    } catch {
      // swallow — retention is housekeeping, not correctness
    }
  }

  const event: TokenSaverEvent = {
    id: newId(),
    sessionId: input.sessionId,
    projectId: settings.projectId,
    createdAt: now(),
    sourceKind: "file",
    // Secret-bearing path → redact before persisting the event label (the
    // chunk-set source is redacted at the persist* sink in read.ts).
    label: redact(input.path).redacted,
    rawBytes: filteredResult.rawBytes,
    returnedBytes: filteredResult.returnedBytes,
    bytesSaved: filteredResult.bytesSaved,
    savingRatio: filteredResult.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filteredResult.summary,
    mode: settings.mode,
  };
  try {
    appendEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted: redactedCount(filteredResult.warnings ?? []),
      chunksStored: filteredResult.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
}

// F4 live-first variant: keyed by (workspaceKey, liveSessionId, cwd) with
// caller-resolved token-saver settings — no registry/session lookup. Events and
// chunk-sets land under the overlay keys (architecture §6.1).
export type RunOverlayOutputInput = {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  cwd: string;
  path: string;
  intent: string;
  mode: TokenSaverMode;
  maxReturnedBytes?: number | undefined;
  storeRawOutput: boolean;
  permissions: ProjectPermissions | null;
  now?: () => string;
  newId?: () => string;
};

export async function runOverlayOutputPipeline(
  input: RunOverlayOutputInput,
): Promise<RunOutputResult> {
  const settings = resolveOverlayEffectiveSettings({
    cwd: input.cwd,
    permissions: input.permissions,
    mode: input.mode,
    maxReturnedBytes: input.maxReturnedBytes,
    storeRawOutput: input.storeRawOutput,
  });

  const gate = runOverlayTwoGates({
    path: input.path,
    cwd: settings.cwd,
    permissions: settings.permissions,
  });
  if (!gate.ok) {
    if (gate.code === "path_denied") {
      appendFirewallEvent(input.storeRoot, {
        at: new Date((input.now ?? defaultNow)()).toISOString(),
        kind: "blocked-read",
        detector: "secret-path",
        count: 1,
        sourcePath: redactForLedger(input.path),
        projectId: input.workspaceKey,
        sessionId: input.liveSessionId,
      });
      return { ok: false, reason: "path_denied", detail: gate.reason };
    }
    return { ok: false, reason: "path_unsafe", detail: gate.message };
  }

  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;
  const sessionDir = join(input.storeRoot, "content", input.workspaceKey, input.liveSessionId);

  const read = await readRaw(gate.absolute);
  if (!read.ok) return { ok: false, reason: "file_read_failed", detail: read.message };

  const newHash = hashContent(read.raw);
  const pathHash = hashPath(gate.absolute);
  const prior = loadReadIndex(sessionDir)[pathHash];
  if (prior !== undefined && prior.contentHash === newHash) {
    return { ok: true, result: unchangedResult(prior.chunkSetId, read.raw) };
  }

  // Failure-aware ranking: prior overlay failure signatures boost any chunk
  // that references them, mirroring the registry read path.
  const { hints: sessionHints, warnings: hintWarnings } = buildOverlayHints(
    input.storeRoot,
    input.workspaceKey,
    input.liveSessionId,
  );
  const filteredResult = await filterRaw({
    raw: read.raw,
    path: input.path,
    intent: input.intent,
    mode: settings.mode,
    maxReturnedBytes: settings.maxReturnedBytes,
    sessionHints,
  });

  appendFirewallEventsFromFilter(
    input.storeRoot,
    {
      at: new Date(now()).toISOString(),
      sourcePath: redactForLedger(input.path),
      projectId: input.workspaceKey,
      sessionId: input.liveSessionId,
    },
    filteredResult.firewall,
  );

  // Strip measurement-only fields (trace + firewall) from the agent-visible
  // result — §P2.6, matching the non-overlay path. The ledger already read
  // filteredResult.firewall above.
  const { trace: _overlayTrace, firewall: _overlayFirewall, ...filteredSansMeta } = filteredResult;
  let result: FilterOutputResult = { ...filteredSansMeta };
  if (hintWarnings.length > 0) {
    result.warnings = [...(result.warnings ?? []), ...hintWarnings];
  }
  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    try {
      await persistOverlayChunkSet({
        storeRoot: input.storeRoot,
        chunkSetId,
        workspaceKey: input.workspaceKey,
        liveSessionId: input.liveSessionId,
        createdAt: now(),
        path: input.path,
        result: filteredResult,
      });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
    recordRead(sessionDir, pathHash, { contentHash: newHash, chunkSetId });
    result = applyShownDedup({ result, sessionDir, chunkSetId });
  }

  const event: OverlayTokenSaverEvent = {
    id: newId(),
    workspaceKey: input.workspaceKey,
    liveSessionId: input.liveSessionId,
    createdAt: now(),
    sourceKind: "file",
    // Secret-bearing path → redact before persisting the event label (the
    // chunk-set source is redacted at the persist* sink in read.ts).
    label: redact(input.path).redacted,
    rawBytes: filteredResult.rawBytes,
    returnedBytes: filteredResult.returnedBytes,
    bytesSaved: filteredResult.bytesSaved,
    savingRatio: filteredResult.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filteredResult.summary,
    mode: settings.mode,
  };
  try {
    appendOverlayEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted: redactedCount(filteredResult.warnings ?? []),
      chunksStored: filteredResult.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
}
