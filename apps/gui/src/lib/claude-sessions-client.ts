import type { BridgeError } from "../components/states.js";
import { authHeaders, withToken } from "./auth.js";

export type Block = {
  kind: "text" | "thinking" | "tool_use" | "tool_result";
  text: string;
};
export type MessageUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};
export type MessageMeta = {
  model?: string;
  usage?: MessageUsage;
  gitBranch?: string;
};
export type NormalizedMessage = {
  role: "user" | "assistant";
  ts: string;
  blocks: Block[];
  meta?: MessageMeta;
};
export type ClaudeSessionMeta = {
  dir: string;
  id: string;
  mtimeMs: number;
  size: number;
  title: string;
  projectLabel: string;
  isArchived: boolean;
  model: string;
  permissionMode: string;
  lastActivityAt: number;
  harness?: string;
  harnessName?: string;
};
export type ClaudeTranscriptSnapshot = {
  projectLabel: string;
  messages: NormalizedMessage[];
};
export type ClaudeWorkspaceGroup = {
  cwd: string;
  label: string;
  sessions: ClaudeSessionMeta[];
};
export type ModelUsage = {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};
export type SessionTelemetry = {
  turnCount: number;
  assistantTurns: number;
  toolCallCount: number;
  totals: MessageUsage;
  models: ModelUsage[];
  firstTs: string;
  lastTs: string;
  durationMs: number;
  gitBranch: string;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() });
  if (response.ok) return (await response.json()) as T;
  let body: BridgeError;
  try {
    body = (await response.json()) as BridgeError;
  } catch {
    body = {
      error: `Bridge request failed with status ${response.status}`,
      code: "internal_error",
    };
  }
  throw body;
}

async function mutateJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        }
      : { headers: authHeaders() }),
  });
  if (response.ok) return (await response.json()) as T;
  let err: BridgeError;
  try {
    err = (await response.json()) as BridgeError;
  } catch {
    err = {
      error: `Bridge request failed with status ${response.status}`,
      code: "internal_error",
    };
  }
  throw err;
}

export function fetchClaudeSessions(
  limit = 50,
  offset = 0,
  harness?: string,
  workspaceKey?: string,
): Promise<ClaudeSessionMeta[]> {
  const h = harness && harness.length > 0 ? `&harness=${encodeURIComponent(harness)}` : "";
  const w =
    workspaceKey && workspaceKey.length > 0
      ? `&workspaceKey=${encodeURIComponent(workspaceKey)}`
      : "";
  return getJson<ClaudeSessionMeta[]>(
    `/api/claude-sessions?limit=${limit}&offset=${offset}${h}${w}`,
  );
}

export type Workspace = {
  key: string;
  label: string;
  sessionCount: number;
  lastActivityMs: number;
};

export function fetchWorkspaces(limit = 50, offset = 0): Promise<Workspace[]> {
  return getJson<Workspace[]>(`/api/workspaces?limit=${limit}&offset=${offset}`);
}

export function fetchClaudeSessionTelemetry(dir: string, id: string): Promise<SessionTelemetry> {
  return getJson<SessionTelemetry>(
    `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/telemetry`,
  );
}

export type StreamHandlers = {
  onSnapshot: (snapshot: ClaudeTranscriptSnapshot) => void;
  onMessage: (message: NormalizedMessage) => void;
  onError: () => void;
};

// Opens an EventSource against the live-stream route. Caller MUST call the
// returned disposer (close()) when switching sessions or unmounting.
export function openClaudeSessionStream(
  dir: string,
  id: string,
  handlers: StreamHandlers,
): () => void {
  const url = `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/stream`;
  const source = new EventSource(withToken(url));
  source.addEventListener("snapshot", (e) => {
    handlers.onSnapshot(JSON.parse((e as MessageEvent).data) as ClaudeTranscriptSnapshot);
  });
  source.addEventListener("message", (e) => {
    handlers.onMessage(JSON.parse((e as MessageEvent).data) as NormalizedMessage);
  });
  // Native EventSource fires "error" on every disconnect/reconnect, including
  // after a successful snapshot (the server closes the stream with `event: end`).
  // Only surface the banner when the readyState is truly closed and no snapshot
  // has been received – transcript-panel's hasSnapshotRef guards this.
  source.addEventListener("error", () => {
    // EventSource.error fires both for transient reconnects and final close.
    // We always notify the panel; it decides via hasSnapshotRef whether to show.
    handlers.onError();
  });
  source.addEventListener("end", () => {
    source.close();
  });
  return () => source.close();
}

// ---- F4: session-scoped overlay (memory / tasks / token-saver) ----

export type MemoryScope = "project" | "session";

export type OverlayMemoryEntry = {
  id: string;
  workspaceKey: string;
  liveSessionId: string | null;
  scope: MemoryScope;
  type: string;
  title: string;
  content: string;
  keywords: string[];
  confidence: string;
  source: string;
  approval: string;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
  validFrom?: string;
  validTo?: string | null;
  supersedesId?: string;
};

export type CreateMemoryInput = {
  content: string;
  scope: MemoryScope;
  type?: string;
  title?: string;
  confidence?: string;
  source?: string;
  keywords?: string[];
};

export type PatchMemoryInput = {
  content?: string;
  title?: string;
  type?: string;
  confidence?: string;
  approval?: string;
  keywords?: string[];
};

export type TaskStep = {
  id: string;
  type: string;
  title: string;
  dependsOn: string[];
  status: string;
};

export type OverlayTaskPlan = {
  id: string;
  workspaceKey: string;
  liveSessionId: string | null;
  task: string;
  status: string;
  steps: TaskStep[];
  createdAt: string;
  updatedAt: string;
};

export type SessionTaskPlanView = { plan: OverlayTaskPlan; ready: string[] };

export type TokenSaverSettings = {
  enabled: boolean;
  mode: string;
  maxReturnedBytes?: number;
  storeRawOutput: boolean;
};

export type SessionTokenSaverStatus = {
  enabled: boolean;
  settings: TokenSaverSettings | null;
};

export type OverlaySessionTokenSaverStats = {
  liveSessionId: string;
  eventsTotal: number;
  rawBytesTotal: number;
  returnedBytesTotal: number;
  bytesSavedTotal: number;
  savingRatio: number;
  secretsRedactedTotal: number;
  chunksStoredTotal: number;
  updatedAt: string;
};

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

export type AllWorkspaceTokenSaverTotals = {
  bytesSavedTotal: number;
  // Signed net (gross minus expansion debits). The bridge always sends it;
  // optional so a stale bridge degrades to the gross fallback in
  // computeSavingsHeadline instead of blanking the headline.
  deltaBytesTotal?: number;
  sessionsCount: number;
  savingRatio: number;
  workspaceCount: number;
};

export type OverlayTokenSaverEvent = {
  id: string;
  workspaceKey: string;
  liveSessionId: string;
  createdAt: string;
  sourceKind: string;
  label: string;
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  savingRatio: number;
  chunkSetId?: string;
  summary: string;
  mode: string;
};

function memoryBase(dir: string, id: string): string {
  return `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/memory`;
}

export function fetchSessionMemory(
  dir: string,
  id: string,
  scope?: MemoryScope,
): Promise<OverlayMemoryEntry[]> {
  const q = scope !== undefined ? `?scope=${scope}` : "";
  return getJson<OverlayMemoryEntry[]>(`${memoryBase(dir, id)}${q}`);
}

export function createSessionMemory(
  dir: string,
  id: string,
  input: CreateMemoryInput,
): Promise<OverlayMemoryEntry> {
  return mutateJson<OverlayMemoryEntry>(memoryBase(dir, id), "POST", input);
}

export function patchSessionMemory(
  dir: string,
  id: string,
  entryId: string,
  input: PatchMemoryInput,
): Promise<OverlayMemoryEntry> {
  return mutateJson<OverlayMemoryEntry>(
    `${memoryBase(dir, id)}/${encodeURIComponent(entryId)}`,
    "PATCH",
    input,
  );
}

export function deleteSessionMemory(
  dir: string,
  id: string,
  entryId: string,
): Promise<{ id: string }> {
  return mutateJson<{ id: string }>(
    `${memoryBase(dir, id)}/${encodeURIComponent(entryId)}`,
    "DELETE",
  );
}

export type MemoryGraphNode = {
  id: string;
  kind: string;
  label: string;
  meta: Record<string, unknown>;
};

export type MemoryGraphEdge = {
  id: string;
  kind: string;
  from: string;
  to: string;
};

export type MemoryGraphData = {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  stats: { nodeCount: number; edgeCount: number };
};

export function fetchSessionMemoryGraph(dir: string, id: string): Promise<MemoryGraphData> {
  return getJson<MemoryGraphData>(`${memoryBase(dir, id)}/graph`);
}

export function fetchSessionTasks(dir: string, id: string): Promise<SessionTaskPlanView[]> {
  return getJson<SessionTaskPlanView[]>(
    `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/tasks`,
  );
}

function tokenSaverBase(dir: string, id: string): string {
  return `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/token-saver`;
}

export function fetchSessionTokenSaverStatus(
  dir: string,
  id: string,
): Promise<SessionTokenSaverStatus> {
  return getJson<SessionTokenSaverStatus>(`${tokenSaverBase(dir, id)}/status`);
}

export function fetchSessionTokenSaverStats(
  dir: string,
  id: string,
): Promise<OverlaySessionTokenSaverStats | null> {
  return getJson<OverlaySessionTokenSaverStats | null>(`${tokenSaverBase(dir, id)}/stats`);
}

export function fetchWorkspaceTokenSaverStats(
  dir: string,
  id: string,
): Promise<WorkspaceTokenSaverTotals | null> {
  return getJson<WorkspaceTokenSaverTotals | null>(`${tokenSaverBase(dir, id)}/workspace-stats`);
}

export function fetchAllWorkspaceTotals(): Promise<AllWorkspaceTokenSaverTotals> {
  return getJson<AllWorkspaceTokenSaverTotals>("/api/token-saver/all-workspaces");
}

export function fetchSessionTokenSaverEvents(
  dir: string,
  id: string,
): Promise<OverlayTokenSaverEvent[]> {
  return getJson<OverlayTokenSaverEvent[]>(`${tokenSaverBase(dir, id)}/events`);
}

export type WorkspaceSaverStatus = {
  enabled: boolean;
  mode: "aggressive" | "balanced" | "safe";
  blockPresent: boolean;
  mcpInstalled: boolean;
  // Effective-activation metadata (source on GET; scope/coverage on POST).
  source?: "exact" | "repository" | "legacy-root" | "global" | "missing" | "invalid";
  repositoryFamilyKey?: string | null;
  familyUnavailableReason?: string | null;
  scope?: "repository" | "exact";
  coverage?: string;
};

export function fetchWorkspaceSaver(dir: string, id: string): Promise<WorkspaceSaverStatus> {
  return getJson<WorkspaceSaverStatus>(`${tokenSaverBase(dir, id)}/workspace`);
}

export function setWorkspaceSaver(
  dir: string,
  id: string,
  input: { enabled: boolean; mode: "aggressive" | "balanced" | "safe" },
): Promise<WorkspaceSaverStatus> {
  return mutateJson<WorkspaceSaverStatus>(`${tokenSaverBase(dir, id)}/workspace`, "POST", input);
}

export type ProxyStatus = {
  enabled: boolean;
  routed: boolean;
  routeConflict: boolean;
  reconcileBlocked: boolean;
  draining: boolean;
  url: string;
  error?: string;
};

export function fetchProxyStatus(): Promise<ProxyStatus> {
  return getJson<ProxyStatus>("/api/proxy");
}

export type DaemonStatus = { running: boolean; url?: string; sessions?: number };

export function fetchDaemonStatus(): Promise<DaemonStatus> {
  return getJson<DaemonStatus>("/api/daemon");
}

export function startDaemon(): Promise<{ ok: boolean; running: boolean; url?: string }> {
  return mutateJson<{ ok: boolean; running: boolean; url?: string }>("/api/daemon/start", "POST");
}

export function stopDaemon(): Promise<{ ok: boolean; running: boolean }> {
  return mutateJson<{ ok: boolean; running: boolean }>("/api/daemon/stop", "POST");
}

export function setProxy(enabled: boolean): Promise<ProxyStatus> {
  return mutateJson<ProxyStatus>("/api/proxy", "POST", { enabled });
}

// Finishes an in-flight drain: an off-toggle keeps the supervisor's key-holding
// listener alive so an already-launched Claude session is not broken mid-flight.
// This confirms clients are restarted so the supervisor stops that listener.
export function finishProxyDrain(): Promise<ProxyStatus> {
  return mutateJson<ProxyStatus>("/api/proxy", "POST", {
    enabled: false,
    confirmClientsRestarted: true,
  });
}

export type ClaudeHookStatus = {
  connected: boolean;
  preInstalled: boolean;
  postInstalled: boolean;
};

export function fetchClaudeHookStatus(): Promise<ClaudeHookStatus> {
  return getJson<ClaudeHookStatus>("/api/hooks/claude-code");
}

export function connectClaudeHook(): Promise<ClaudeHookStatus> {
  return mutateJson<ClaudeHookStatus>("/api/hooks/claude-code", "POST");
}

export function disconnectClaudeHook(): Promise<ClaudeHookStatus> {
  return mutateJson<ClaudeHookStatus>("/api/hooks/claude-code", "DELETE");
}

export type MemoryHistoryResponse = {
  entryId: string;
  chain: OverlayMemoryEntry[];
  supersedesId: string | null;
  validFrom: string;
  validTo: string | null;
};

export function fetchMemoryHistory(
  dir: string,
  id: string,
  entryId: string,
): Promise<MemoryHistoryResponse> {
  return getJson<MemoryHistoryResponse>(
    `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}/history`,
  );
}

export function reopenSessionMemory(
  dir: string,
  id: string,
  entryId: string,
): Promise<OverlayMemoryEntry> {
  return mutateJson<OverlayMemoryEntry>(
    `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}/reopen`,
    "POST",
  );
}

export type MemoryExplainResponse = {
  entryId: string;
  confidence: string;
  effectiveConfidence: number;
  source: string;
  scope: string;
  isCurrent: boolean;
};

export function fetchMemoryExplain(
  dir: string,
  id: string,
  entryId: string,
): Promise<MemoryExplainResponse> {
  return getJson<MemoryExplainResponse>(
    `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}/explain`,
  );
}

export type BrainSyncStatusResponse =
  | { configured: false; status: "idle"; lastSyncedAt: null; workspaceKey?: string; cwd?: string }
  | {
      configured: false;
      status: "not_configured";
      lastSyncedAt: null;
      workspaceKey?: string;
      cwd?: string;
      code?: string;
      error?: string;
    }
  | {
      configured: true;
      status: "empty" | "ok";
      lastSyncedAt: string | null;
      generation: number;
      upToDate: boolean;
      remoteGeneration: number;
      updatedAt: string | null;
      workspaceKey: string;
      cwd: string;
    };

export type BrainSyncTriggerResponse =
  | {
      status: "pushed";
      syncedAt: string;
      generation: number;
      merged: boolean;
      workspaceKey: string;
      cwd: string;
    }
  | {
      status: "up-to-date";
      syncedAt: string;
      generation: number;
      merged?: boolean;
      workspaceKey?: string;
      cwd?: string;
    }
  | { status: "empty"; syncedAt: string; generation: number; workspaceKey?: string; cwd?: string }
  | { status: "merged"; syncedAt: string; generation: number; workspaceKey?: string; cwd?: string }
  | {
      status: "ok";
      syncedAt: string;
      generation: number;
      upToDate: boolean;
      remoteGeneration: number;
      updatedAt: string;
      workspaceKey?: string;
      cwd?: string;
    };

function brainSyncStatusQuery(dir: string | undefined, id: string | undefined): string {
  const qs = new URLSearchParams();
  if (dir) qs.set("dir", dir);
  if (id) qs.set("id", id);
  const s = qs.toString();
  return s.length > 0 ? `?${s}` : "";
}

export type BrainSyncAutoInitResponse = {
  ok: boolean;
  status: string;
  configured: boolean;
  generation: number;
  recoveryCode: string;
  workspaceKey: string;
  cwd: string;
};

export function autoInitBrainSync(dir?: string, id?: string): Promise<BrainSyncAutoInitResponse> {
  const query = brainSyncStatusQuery(dir, id);
  return mutateJson<BrainSyncAutoInitResponse>(`/api/brain/sync/auto-init${query}`, "POST");
}

export function fetchBrainSyncStatus(dir?: string, id?: string): Promise<BrainSyncStatusResponse> {
  return getJson<BrainSyncStatusResponse>(`/api/brain/sync/status${brainSyncStatusQuery(dir, id)}`);
}

export function triggerBrainSync(
  dir?: string,
  id?: string,
  action: "push" | "pull" | "status" = "push",
): Promise<BrainSyncTriggerResponse> {
  const base = brainSyncStatusQuery(dir, id);
  const sep = base.length > 0 ? "&" : "?";
  return mutateJson<BrainSyncTriggerResponse>(
    `/api/brain/sync/trigger${base}${sep}action=${action}`,
    "POST",
  );
}

export type HandoffPackResponse = {
  targetAgent: string;
  packed: boolean;
  findingsCount: number;
  brief: string;
};

export function packHandoff(
  workspaceKey: string,
  targetAgent: string,
): Promise<HandoffPackResponse> {
  return mutateJson<HandoffPackResponse>("/api/handoff/pack", "POST", {
    workspaceKey,
    targetAgent,
  });
}

export function clearHandoff(
  workspaceKey: string,
  targetAgent: string,
): Promise<{ cleared: boolean; targetAgent: string }> {
  return mutateJson<{ cleared: boolean; targetAgent: string }>(
    `/api/handoff/clear?workspaceKey=${encodeURIComponent(workspaceKey)}&targetAgent=${encodeURIComponent(targetAgent)}`,
    "DELETE",
  );
}

export type RoiResponse = {
  savedDollars: number;
  timeSavedHours: number;
  roiRatio: number;
  projectedAnnualSavings: number;
};

export function fetchRoi(): Promise<RoiResponse> {
  return getJson<RoiResponse>("/api/roi");
}

export type BudgetResponse = {
  monthlyBudgetTokens: number;
  spentTokens: number;
  pacePercent: number;
  isOverBudget: boolean;
};

export function fetchBudget(): Promise<BudgetResponse> {
  return getJson<BudgetResponse>("/api/savings/budget");
}

export function setBudget(monthlyBudgetTokens: number): Promise<BudgetResponse> {
  return mutateJson<BudgetResponse>("/api/savings/budget", "POST", { monthlyBudgetTokens });
}

export type ForgeFailuresResponse = {
  failures: { id: string; pattern: string; occurrences: number; ruleCreated: boolean }[];
};

export function fetchForgeFailures(): Promise<ForgeFailuresResponse> {
  return getJson<ForgeFailuresResponse>("/api/forge/failures");
}

export function postForgeLearn(
  failureId: string,
  ruleTitle?: string,
): Promise<{ learned: boolean; ruleId: string; ruleTitle: string }> {
  return mutateJson<{ learned: boolean; ruleId: string; ruleTitle: string }>(
    "/api/forge/learn",
    "POST",
    { failureId, ruleTitle },
  );
}

export type CacheStatusResponse = {
  cacheHitRatio: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  churnDetected: boolean;
};

export function fetchCacheStatus(): Promise<CacheStatusResponse> {
  return getJson<CacheStatusResponse>("/api/cache/status");
}

export function postCacheClear(): Promise<{ cleared: boolean; clearedAt: string }> {
  return mutateJson<{ cleared: boolean; clearedAt: string }>("/api/cache/clear", "POST");
}

export type SkillPackItem = { id: string; name: string; version: string; installed: boolean };

export function fetchSkillPacks(): Promise<{ packs: SkillPackItem[] }> {
  return getJson<{ packs: SkillPackItem[] }>("/api/packs/installed");
}

export function installSkillPack(packId: string): Promise<{ installed: boolean; packId: string }> {
  return mutateJson<{ installed: boolean; packId: string }>("/api/packs/install", "POST", {
    packId,
  });
}
