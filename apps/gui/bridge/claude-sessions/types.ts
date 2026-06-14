export type BlockKind = "text" | "thinking" | "tool_use" | "tool_result";

export type Block = { kind: BlockKind; text: string };

export type NormalizedMessage = {
  role: "user" | "assistant";
  ts: string;
  blocks: Block[];
};

export type ClaudeSessionMeta = {
  dir: string;
  id: string;
  mtimeMs: number;
  size: number;
  title: string;
  projectLabel: string;
};

export type ClaudeTranscript = {
  dir: string;
  id: string;
  projectLabel: string;
  byteLength: number;
  messages: NormalizedMessage[];
};
