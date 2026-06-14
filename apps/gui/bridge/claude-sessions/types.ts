export type BlockKind = "text" | "thinking" | "tool_use" | "tool_result";

export type Block = { kind: BlockKind; text: string };

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

export type Workspace = {
  key: string;
  label: string;
  sessionCount: number;
  lastActivityMs: number;
};

export type ClaudeTranscript = {
  dir: string;
  id: string;
  projectLabel: string;
  byteLength: number;
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
