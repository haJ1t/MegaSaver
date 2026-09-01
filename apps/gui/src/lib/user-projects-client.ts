import type { BridgeError } from "../components/states.js";
import { authHeaders } from "./auth.js";

export type UserProjectsResponse = {
  paths: string[];
  workspaces: { key: string; cwd: string; label: string }[];
};

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  let body: BridgeError;
  try {
    body = (await response.json()) as BridgeError;
  } catch {
    body = { error: `Request failed with status ${response.status}`, code: "internal_error" };
  }
  throw body;
}

export function fetchUserProjects(): Promise<UserProjectsResponse> {
  return fetch("/api/user-projects", { headers: authHeaders() }).then(
    handleResponse<UserProjectsResponse>,
  );
}

export function addUserProject(path: string): Promise<UserProjectsResponse> {
  return fetch("/api/user-projects", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ path }),
  }).then(handleResponse<UserProjectsResponse>);
}

export function removeUserProject(path: string): Promise<UserProjectsResponse> {
  return fetch(`/api/user-projects?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: authHeaders(),
  }).then(handleResponse<UserProjectsResponse>);
}
