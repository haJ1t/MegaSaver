import { z } from "zod";

// Order: alphabetic. Used as schema-canonical ordering for derived
// CLI error messages and --help text. Do not reorder.
// v1.1 harness catalog (2026-08-26): the 39 detected harness ids
// (harness-autodetect) join the original 7 connector agents + generic-cli.
export const agentIdSchema = z.enum([
  "aider",
  "amazon-q",
  "amp",
  "antigravity",
  "avante",
  "bits",
  "claude-code",
  "cline",
  "codex",
  "cody",
  "continue",
  "copilot",
  "crush",
  "cursor",
  "deepseek",
  "devin",
  "droid",
  "gemini",
  "generic-cli",
  "gpt-engineer",
  "gptme",
  "goose",
  "grok",
  "hermes",
  "iflow",
  "kilo-code",
  "mentat",
  "openclaw",
  "opencode",
  "openhands",
  "plandex",
  "qodo",
  "qwen",
  "refact",
  "roo-code",
  "tabby",
  "trae",
  "warp",
  "windsurf",
  "zed",
]);

export type AgentId = z.infer<typeof agentIdSchema>;
