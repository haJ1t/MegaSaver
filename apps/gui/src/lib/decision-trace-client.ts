import type { BridgeError } from "../components/states.js";
import { authHeaders } from "./auth.js";

// Mirror of `@megasaver/output-filter`'s SessionDecisionTrace, re-declared on the
// client so the browser bundle never imports the Node reader. Kept structurally
// identical; the bridge serializes the reader's output to this shape verbatim.
export type RankedChunkView = {
  startLine: number;
  endLine: number;
  score: number;
  engine: {
    baseRelevance: number;
    memoryBoost: number;
    failureHistoryBoost: number;
    finalScore: number;
  };
};

export type DecisionOutput = {
  chunkSetId: string | null;
  toolName: string;
  createdAt: string;
  classification: { category: string; confidence: number };
  decision: string;
  selected: RankedChunkView[];
  omitted: RankedChunkView[];
  memory: { rankedByMemoryIds: string[] } | null;
  redaction: { redacted: boolean; highRiskFindings: number } | null;
  evidencePresent: boolean;
};

export type SessionDecisionTrace = {
  projectId: string;
  sessionId: string;
  outputs: DecisionOutput[];
};

export type DecisionTraceNode = {
  id: string;
  kind: "output" | "chunk" | "memory" | "redaction";
  label: string;
  meta: Record<string, unknown>;
};

export type DecisionTraceEdge = {
  source: string;
  target: string;
  kind: "ranked" | "pinned" | "redacted";
};

export type DecisionTraceData = {
  nodes: DecisionTraceNode[];
  edges: DecisionTraceEdge[];
  stats: { outputs: number; chunks: number; memoriesPinned: number };
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

// One selectable registry trace session for the project-scoped picker. `sessionId`
// is the `mega session create` randomUUID (the trace-dir name minus `-traces`),
// which the reader keys off — distinct from the cockpit transcript UUID.
export type DecisionTraceSessionSummary = {
  sessionId: string;
  outputs: number;
  latestCreatedAt: string | null;
};

export function fetchDecisionTraceSessions(
  dir: string,
  id: string,
): Promise<{ sessions: DecisionTraceSessionSummary[] }> {
  return getJson<{ sessions: DecisionTraceSessionSummary[] }>(
    `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/decision-trace/sessions`,
  );
}

export function fetchDecisionTraceGraph(
  dir: string,
  id: string,
  sessionId?: string,
): Promise<DecisionTraceData> {
  const base = `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/decision-trace/graph`;
  const path = sessionId !== undefined ? `${base}?session=${encodeURIComponent(sessionId)}` : base;
  return getJson<DecisionTraceData>(path);
}
