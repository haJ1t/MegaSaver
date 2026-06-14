import type { ContextPack, PackAudit } from "@megasaver/context-pruner";
import type {
  MemoryEntry,
  Project,
  ProjectRule,
  RankedRule,
  Session,
  TaskPlan,
  TokenSaverSettings,
  ToolDefinition,
  ToolRouteResult,
} from "@megasaver/core";
import type { BlockSearchHit } from "@megasaver/indexer";
import type { TaskStepId } from "@megasaver/shared";
import type { AuditSummary, SessionTokenSaverStats, TokenSaverEvent } from "@megasaver/stats";
import type { BridgeError } from "../components/states.js";

export type HealthResponse = {
  ok: true;
  store: string;
};

// ── Response handling ─────────────────────────────────────────────────────────

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }
  // Bridge returns structured error envelope per spec §4b.
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  return handleResponse<T>(response);
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  return handleResponse<T>(response);
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: "DELETE" });
  return handleResponse<T>(response);
}

function qs(params: Record<string, string | number | undefined | readonly string[]>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, v);
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : "";
}

// ── Read endpoints ────────────────────────────────────────────────────────────

export function fetchHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>("/api/health");
}

export function fetchProjects(): Promise<Project[]> {
  return getJson<Project[]>("/api/projects");
}

export function fetchSessions(projectId: string): Promise<Session[]> {
  return getJson<Session[]>(`/api/sessions?projectId=${encodeURIComponent(projectId)}`);
}

export type MemoryQuery = { query?: string; limit?: number; offset?: number };

export function fetchMemory(projectId: string, opts: MemoryQuery = {}): Promise<MemoryEntry[]> {
  return getJson<MemoryEntry[]>(
    `/api/memory${qs({ projectId, query: opts.query, limit: opts.limit, offset: opts.offset })}`,
  );
}

// ── Write endpoints ───────────────────────────────────────────────────────────

export type CreateSessionBody = {
  projectId: string;
  agentId: string;
  title?: string;
  riskLevel?: string;
};

export function createSession(body: CreateSessionBody): Promise<Session> {
  return postJson<Session>("/api/sessions", body);
}

export type EndSessionBody = {
  endedAt?: string;
};

export function endSession(sessionId: string, body?: EndSessionBody): Promise<Session> {
  return postJson<Session>(`/api/sessions/${encodeURIComponent(sessionId)}/end`, body ?? {});
}

export type UpdateSessionBody = {
  title?: string | null;
  riskLevel?: string;
  agentId?: string;
};

export function updateSession(sessionId: string, body: UpdateSessionBody): Promise<Session> {
  return patchJson<Session>(`/api/sessions/${encodeURIComponent(sessionId)}`, body);
}

export type CreateMemoryBody = {
  projectId: string;
  content: string;
  scope: string;
  sessionId?: string;
};

export function createMemoryEntry(body: CreateMemoryBody): Promise<MemoryEntry> {
  return postJson<MemoryEntry>("/api/memory", body);
}

// ── Token-saver endpoints (BB10) ────────────────────────────────────────────

export type TokenSaverStatusResponse = {
  enabled: boolean;
  settings: TokenSaverSettings | null;
};

export type EnableTokenSaverBody = {
  mode?: string;
  maxReturnedBytes?: number;
  storeRawOutput?: boolean;
  redactSecrets?: boolean;
  autoRepair?: boolean;
};

function tokenSaverBase(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/token-saver`;
}

export function enableTokenSaver(sessionId: string, body?: EnableTokenSaverBody): Promise<Session> {
  return postJson<Session>(`${tokenSaverBase(sessionId)}/enable`, body ?? {});
}

export function disableTokenSaver(sessionId: string): Promise<Session> {
  return postJson<Session>(`${tokenSaverBase(sessionId)}/disable`, {});
}

export function fetchTokenSaverStatus(sessionId: string): Promise<TokenSaverStatusResponse> {
  return getJson<TokenSaverStatusResponse>(`${tokenSaverBase(sessionId)}/status`);
}

export function fetchTokenSaverStats(sessionId: string): Promise<SessionTokenSaverStats | null> {
  return getJson<SessionTokenSaverStats | null>(`${tokenSaverBase(sessionId)}/stats`);
}

export function fetchTokenSaverEvents(sessionId: string): Promise<TokenSaverEvent[]> {
  return getJson<TokenSaverEvent[]>(`${tokenSaverBase(sessionId)}/events`);
}

export function tokenSaverEventRawUrl(sessionId: string, eventId: string): string {
  return `${tokenSaverBase(sessionId)}/events/${encodeURIComponent(eventId)}/raw`;
}

export function tokenSaverEventSentUrl(sessionId: string, eventId: string): string {
  return `${tokenSaverBase(sessionId)}/events/${encodeURIComponent(eventId)}/sent`;
}

// ── Retention endpoints (epic 3d) ───────────────────────────────────────────

export type RetentionSummary = {
  chunkSets: number;
  totalBytes: number;
  oldestAt: string | null;
};

function retentionBase(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/retention`;
}

export function fetchRetention(sessionId: string): Promise<RetentionSummary> {
  return getJson<RetentionSummary>(retentionBase(sessionId));
}

export function clearRetention(sessionId: string): Promise<RetentionSummary> {
  return postJson<RetentionSummary>(`${retentionBase(sessionId)}/clear`, {});
}

// ── MCP setup endpoints (BB11) ──────────────────────────────────────────────
// Shapes mirror BB8's McpStatusResult (agentId only — no separate `target`
// field). install/repair carry the active project (epic §7 — the connector
// block is written into that project's agent files); uninstall + status do not.

export type McpAgentStatus = {
  agentId: string;
  mcpInstalled: boolean;
  connectorSynced: boolean;
  restartRequired: boolean;
  restartHint: string;
};
export type McpStatusResponse = { agents: McpAgentStatus[] };

export function fetchMcpStatus(): Promise<McpStatusResponse> {
  return getJson<McpStatusResponse>("/api/mcp/status");
}

export function installMcp(target: string, project: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/install", { target, project });
}

export function repairMcp(target: string, project: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/repair", { target, project });
}

export function uninstallMcp(target: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/uninstall", { target });
}

// ── Project create (P0) ─────────────────────────────────────────────────────

export type CreateProjectBody = { name: string; rootPath: string };

export function createProject(body: CreateProjectBody): Promise<Project> {
  return postJson<Project>("/api/projects", body);
}

// ── Memory mutation (P0/P1) ─────────────────────────────────────────────────
// Editable subset of Core's update patch (the bridge stamps updatedAt).

export type MemoryPatchBody = {
  approval?: "suggested" | "approved" | "rejected";
  type?: string;
  title?: string;
  content?: string;
  confidence?: string;
  source?: string;
  keywords?: string[];
  reason?: string;
  goal?: string;
  stale?: boolean;
  expiresAt?: string | null;
};

export function updateMemoryEntry(id: string, body: MemoryPatchBody): Promise<MemoryEntry> {
  return patchJson<MemoryEntry>(`/api/memory/${encodeURIComponent(id)}`, body);
}

export function deleteMemoryEntry(id: string): Promise<{ id: string }> {
  return deleteJson<{ id: string }>(`/api/memory/${encodeURIComponent(id)}`);
}

// ── Audit (P0 Overview) ─────────────────────────────────────────────────────

export type AuditQuery = { window?: "session" | "week" | "all"; session?: string };

export function fetchAudit(projectId: string, opts: AuditQuery = {}): Promise<AuditSummary> {
  return getJson<AuditSummary>(
    `/api/projects/${encodeURIComponent(projectId)}/audit${qs({ window: opts.window, session: opts.session })}`,
  );
}

// ── Rules (P1) ──────────────────────────────────────────────────────────────

export type RulesQuery = { task?: string; files?: readonly string[] };

export function fetchRules(projectId: string, opts: RulesQuery = {}): Promise<RankedRule[]> {
  return getJson<RankedRule[]>(
    `/api/projects/${encodeURIComponent(projectId)}/rules${qs({ task: opts.task, files: opts.files })}`,
  );
}

// ── Index (P1, file-backed) ─────────────────────────────────────────────────

export type IndexStatus = {
  indexed: boolean;
  total: number;
  indexedFiles: number;
  byType: Record<string, number>;
};

export function fetchIndexStatus(projectId: string): Promise<IndexStatus> {
  return getJson<IndexStatus>(`/api/projects/${encodeURIComponent(projectId)}/index`);
}

export type IndexSearchQuery = { q: string; type?: string; limit?: number; offset?: number };

export function searchIndex(projectId: string, opts: IndexSearchQuery): Promise<BlockSearchHit[]> {
  return getJson<BlockSearchHit[]>(
    `/api/projects/${encodeURIComponent(projectId)}/index/search${qs({
      q: opts.q,
      type: opts.type,
      limit: opts.limit,
      offset: opts.offset,
    })}`,
  );
}

// ── Context preview (P1, file-backed) ───────────────────────────────────────

export type ContextPreview = { indexed: boolean; pack: ContextPack; audit: PackAudit };
export type ContextQuery = {
  task: string;
  limit?: number;
  maxTokens?: number;
  changedFile?: readonly string[];
  failingTest?: readonly string[];
};

export function fetchContext(projectId: string, opts: ContextQuery): Promise<ContextPreview> {
  return getJson<ContextPreview>(
    `/api/projects/${encodeURIComponent(projectId)}/context${qs({
      task: opts.task,
      limit: opts.limit,
      maxTokens: opts.maxTokens,
      changedFile: opts.changedFile,
      failingTest: opts.failingTest,
    })}`,
  );
}

// ── Tasks (P1) ──────────────────────────────────────────────────────────────

export type ReadyTaskPlan = { plan: TaskPlan; ready: TaskStepId[] };

export function fetchTasks(projectId: string): Promise<ReadyTaskPlan[]> {
  return getJson<ReadyTaskPlan[]>(`/api/projects/${encodeURIComponent(projectId)}/tasks`);
}

// ── Tools route preview (P1) ────────────────────────────────────────────────

export type ToolsRouteResponse = { route: ToolRouteResult; tools: ToolDefinition[] };

export function fetchToolsRoute(
  projectId: string,
  opts: { task?: string } = {},
): Promise<ToolsRouteResponse> {
  return getJson<ToolsRouteResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/tools${qs({ task: opts.task })}`,
  );
}

// Re-export ProjectRule so views can render rule fields without a second import.
export type { ProjectRule };
