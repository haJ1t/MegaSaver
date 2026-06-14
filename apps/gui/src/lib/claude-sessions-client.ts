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

export function fetchClaudeSessions(limit = 50, offset = 0): Promise<ClaudeSessionMeta[]> {
  return getJson<ClaudeSessionMeta[]>(`/api/claude-sessions?limit=${limit}&offset=${offset}`);
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
