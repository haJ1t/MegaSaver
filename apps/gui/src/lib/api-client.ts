import type { BridgeError } from "../components/states.js";
import { authHeaders } from "./auth.js";

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

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() });
  return handleResponse<T>(response);
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  return handleResponse<T>(response);
}

export async function deleteJson(path: string): Promise<void> {
  const response = await fetch(path, { method: "DELETE", headers: authHeaders() });
  if (response.status === 204) return;
  // Non-204 success codes: still ok
  if (response.ok) return;
  let body: import("../components/states.js").BridgeError;
  try {
    body = (await response.json()) as import("../components/states.js").BridgeError;
  } catch {
    body = {
      error: `Bridge request failed with status ${response.status}`,
      code: "internal_error",
    };
  }
  throw body;
}

// ── Health ────────────────────────────────────────────────────────────────────

export function fetchHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>("/api/health");
}

// ── Projects ──────────────────────────────────────────────────────────────────

export type Project = { id: string; name: string; rootPath: string };

export function fetchProjects(): Promise<Project[]> {
  return getJson<Project[]>("/api/projects");
}

// ── MCP setup endpoints (BB11) ──────────────────────────────────────────────
// Shapes mirror BB8's McpStatusResult (agentId only — no separate `target`
// field). AgentSetupDoctor now selects a real project before install/repair,
// so the `project` field is the user's chosen project name, not a placeholder.

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
