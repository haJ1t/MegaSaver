import type { EvaluateCommandResult, EvaluatePathReadResult } from "@megasaver/policy";
import type { BridgeError } from "../components/states.js";
import { authHeaders } from "./auth.js";

// Mirrors the bridge response shapes (§4.3). Kept structural so the client does
// not couple the GUI to every overlay-store package's deep types.
export type WorkspaceIndexStatus = {
  indexed: boolean;
  total: number;
  indexedFiles: number;
  byType: Record<string, number>;
};

export type WorkspaceBlockHit = {
  block: { id: string; filePath: string; blockType: string; name?: string };
  score: number;
};

export type WorkspaceContextResponse = {
  indexed: boolean;
  pack?: { blocks: { filePath: string }[] } & Record<string, unknown>;
  audit?: Record<string, unknown>;
};

export type WorkspaceRankedRule = {
  rule: { title: string; rule: string; severity: string };
  score: number;
  reason: string;
};

export type WorkspaceTool = {
  id: string;
  name: string;
  description: string;
  category: string;
  risk: string;
};

export type WorkspaceToolsResponse = {
  route: { allowedTools: WorkspaceTool[]; blockedTools: WorkspaceTool[]; reason: string };
  tools: WorkspaceTool[];
};

export type WorkspacePermissionsResponse = {
  loaded: boolean;
  evaluation?: {
    command?: EvaluateCommandResult;
    pathRead?: EvaluatePathReadResult;
  };
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

export function fetchWorkspaceIndex(key: string): Promise<WorkspaceIndexStatus> {
  return getJson<WorkspaceIndexStatus>(`/api/workspaces/${key}/index`);
}

export function fetchWorkspaceIndexSearch(
  key: string,
  query: string,
): Promise<WorkspaceBlockHit[]> {
  return getJson<WorkspaceBlockHit[]>(
    `/api/workspaces/${key}/index/search?q=${encodeURIComponent(query)}`,
  );
}

export function fetchWorkspaceContext(
  key: string,
  task: string,
): Promise<WorkspaceContextResponse> {
  return getJson<WorkspaceContextResponse>(
    `/api/workspaces/${key}/context?task=${encodeURIComponent(task)}`,
  );
}

export function fetchWorkspaceRules(key: string, task?: string): Promise<WorkspaceRankedRule[]> {
  const q = task !== undefined && task.length > 0 ? `?task=${encodeURIComponent(task)}` : "";
  return getJson<WorkspaceRankedRule[]>(`/api/workspaces/${key}/rules${q}`);
}

export function fetchWorkspaceTools(key: string, task?: string): Promise<WorkspaceToolsResponse> {
  const q = task !== undefined && task.length > 0 ? `?task=${encodeURIComponent(task)}` : "";
  return getJson<WorkspaceToolsResponse>(`/api/workspaces/${key}/tools${q}`);
}

export function fetchWorkspacePermissions(
  key: string,
  opts?: { command?: string; path?: string },
): Promise<WorkspacePermissionsResponse> {
  const params = new URLSearchParams();
  if (opts?.command) params.set("command", opts.command);
  if (opts?.path) params.set("path", opts.path);
  const q = params.toString();
  return getJson<WorkspacePermissionsResponse>(
    `/api/workspaces/${key}/permissions${q.length > 0 ? `?${q}` : ""}`,
  );
}
