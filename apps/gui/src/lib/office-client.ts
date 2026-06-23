// Local TS types mirroring the engine shapes (GUI does not import node packages).

export type OfficeRole = {
  id: string;
  name: string;
  kind: string;
  persona?: string;
  model?: string;
  permissionMode: string;
  allowedTools: string[];
  defaultWorkdir?: string;
  createdAt: string;
};

export type OfficeAgent = {
  id: string;
  name: string;
  roleId: string;
  workdir?: string;
  status: OfficeAgentStatus;
  createdAt: string;
};

export type OfficeAgentStatus = "idle" | "working" | "paused" | "error" | "stopped";

export type OfficeTask = {
  id: string;
  agentId: string;
  instruction: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type OfficeAuditEvent = {
  id: string;
  agentId: string;
  type: string;
  ts: string;
  payload?: unknown;
};

export type OfficeStatusEntry = {
  agent: OfficeAgent;
  currentTask: OfficeTask | null;
  lastEvent: OfficeAuditEvent | null;
};

export type OfficeStatus = {
  agents: OfficeStatusEntry[];
};

// ── Input types ───────────────────────────────────────────────────────────────

export type CreateRoleInput = {
  name: string;
  kind?: string;
  persona?: string;
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
  defaultWorkdir?: string;
};

export type CreateAgentInput = {
  name: string;
  roleId: string;
  workdir?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

import { deleteJson, getJson, postJson } from "./api-client.js";

// ── Roles ─────────────────────────────────────────────────────────────────────

export function fetchRoles(): Promise<OfficeRole[]> {
  return getJson<OfficeRole[]>("/api/office/roles");
}

export function createRole(input: CreateRoleInput): Promise<OfficeRole> {
  return postJson<OfficeRole>("/api/office/roles", input);
}

export function deleteRole(roleId: string): Promise<void> {
  return deleteJson(`/api/office/roles/${encodeURIComponent(roleId)}`);
}

// ── Agents ────────────────────────────────────────────────────────────────────

export function fetchAgents(wk: string): Promise<OfficeAgent[]> {
  return getJson<OfficeAgent[]>(`/api/office/${encodeURIComponent(wk)}/agents`);
}

export function createAgent(wk: string, input: CreateAgentInput): Promise<OfficeAgent> {
  return postJson<OfficeAgent>(`/api/office/${encodeURIComponent(wk)}/agents`, input);
}

export function deleteAgent(wk: string, agentId: string): Promise<void> {
  return deleteJson(`/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}`);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function fetchTasks(wk: string, agentId: string): Promise<OfficeTask[]> {
  return getJson<OfficeTask[]>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/tasks`,
  );
}

export function assignTask(wk: string, agentId: string, instruction: string): Promise<OfficeTask> {
  return postJson<OfficeTask>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/tasks`,
    { instruction },
  );
}

// ── Run / control ─────────────────────────────────────────────────────────────

export function runAgent(wk: string, agentId: string): Promise<OfficeAgent> {
  return postJson<OfficeAgent>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/run`,
  );
}

export function controlAgent(
  wk: string,
  agentId: string,
  action: "pause" | "resume" | "stop",
): Promise<OfficeAgent> {
  return postJson<OfficeAgent>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/control`,
    { action },
  );
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function fetchAudit(wk: string): Promise<OfficeAuditEvent[]> {
  return getJson<OfficeAuditEvent[]>(`/api/office/${encodeURIComponent(wk)}/audit`);
}

// ── Status ────────────────────────────────────────────────────────────────────

export function fetchOfficeStatus(wk: string): Promise<OfficeStatus> {
  return getJson<OfficeStatus>(`/api/office/${encodeURIComponent(wk)}/status`);
}

// ── SSE stream ────────────────────────────────────────────────────────────────

export type OfficeStreamHandlers = {
  onStatus: (status: OfficeStatus) => void;
  onError: () => void;
};

// Opens an EventSource against the office stream route. Caller MUST call the
// returned disposer (close()) when switching workspaces or unmounting.
export function openOfficeStream(wk: string, handlers: OfficeStreamHandlers): () => void {
  const url = `/api/office/${encodeURIComponent(wk)}/stream`;
  const source = new EventSource(url);
  source.addEventListener("snapshot", (e) => {
    handlers.onStatus(JSON.parse((e as MessageEvent).data) as OfficeStatus);
  });
  source.addEventListener("status", (e) => {
    handlers.onStatus(JSON.parse((e as MessageEvent).data) as OfficeStatus);
  });
  source.addEventListener("error", () => handlers.onError());
  return () => source.close();
}

// ── Transcript ──────────────────────────────────────────────────────────────

export type TranscriptEntry = {
  id: string;
  seq: number;
  ts: string;
  role: "user" | "assistant" | "tool" | "tool_result" | "result" | "stderr";
  text?: string;
  tool?: string;
  summary?: string;
};

export function fetchTranscript(wk: string, agentId: string): Promise<TranscriptEntry[]> {
  return getJson<TranscriptEntry[]>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/transcript`,
  );
}

// Send a chat message to the agent. The user turn + the agent's reply both
// arrive over the transcript stream; this returns the queued task.
export function sendChat(wk: string, agentId: string, message: string): Promise<OfficeTask> {
  return postJson<OfficeTask>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/chat`,
    { message },
  );
}

export type TranscriptStreamHandlers = {
  onEntry: (entry: TranscriptEntry) => void;
  onError: () => void;
};

// Opens an EventSource against an agent's live transcript stream. Caller MUST
// call the returned disposer when the selected agent changes or on unmount.
export function openTranscriptStream(
  wk: string,
  agentId: string,
  handlers: TranscriptStreamHandlers,
): () => void {
  const url = `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/transcript/stream`;
  const source = new EventSource(url);
  source.addEventListener("transcript", (e) => {
    handlers.onEntry(JSON.parse((e as MessageEvent).data) as TranscriptEntry);
  });
  source.addEventListener("error", () => handlers.onError());
  return () => source.close();
}
