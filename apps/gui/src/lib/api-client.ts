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

// ── Health ────────────────────────────────────────────────────────────────────

export function fetchHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>("/api/health");
}

// ── MCP setup endpoints (BB11) ──────────────────────────────────────────────
// Shapes mirror BB8's McpStatusResult (agentId only — no separate `target`
// field). The live-first GUI is project-free, but the bridge's
// MEGA_MCP_TARGET_BODY schema still requires a non-empty `project` for
// install/repair (mcp-bridge is out of scope). Install ignores it backend-side;
// repair feeds it to connectorSync as a path root, where "." (cwd) is benign.

const MCP_PROJECT_PLACEHOLDER = ".";

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

export function installMcp(target: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/install", {
    target,
    project: MCP_PROJECT_PLACEHOLDER,
  });
}

export function repairMcp(target: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/repair", {
    target,
    project: MCP_PROJECT_PLACEHOLDER,
  });
}

export function uninstallMcp(target: string): Promise<McpStatusResponse> {
  return postJson<McpStatusResponse>("/api/mcp/uninstall", { target });
}
