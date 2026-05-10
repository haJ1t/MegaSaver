import type { MemoryEntry, Session } from "@megasaver/core";

export type HealthResponse = {
  ok: true;
  store: string;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`bridge ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson<HealthResponse>("/api/health");
}

export function fetchSessions(): Promise<Session[]> {
  return getJson<Session[]>("/api/sessions");
}

export function fetchMemory(): Promise<MemoryEntry[]> {
  return getJson<MemoryEntry[]>("/api/memory");
}
