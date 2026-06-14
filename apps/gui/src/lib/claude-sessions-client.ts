import type { BridgeError } from "../components/states.js";

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
  const response = await fetch(path);
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
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
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

export function fetchClaudeSessions(limit = 50, offset = 0): Promise<ClaudeSessionMeta[]> {
  return getJson<ClaudeSessionMeta[]>(`/api/claude-sessions?limit=${limit}&offset=${offset}`);
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
  const source = new EventSource(url);
  source.addEventListener("snapshot", (e) => {
    handlers.onSnapshot(JSON.parse((e as MessageEvent).data) as ClaudeTranscriptSnapshot);
  });
  source.addEventListener("message", (e) => {
    handlers.onMessage(JSON.parse((e as MessageEvent).data) as NormalizedMessage);
  });
  source.addEventListener("error", () => handlers.onError());
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
