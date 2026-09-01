import type { BridgeError } from "../components/states.js";
import { authHeaders } from "./auth.js";

export type FsBrowseResponse = {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
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

export function browseFs(path?: string): Promise<FsBrowseResponse> {
  const q = path && path.length > 0 ? `?path=${encodeURIComponent(path)}` : "";
  return fetch(`/api/fs/browse${q}`, { headers: authHeaders() }).then(
    handleResponse<FsBrowseResponse>,
  );
}
