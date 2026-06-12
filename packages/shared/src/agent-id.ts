import { z } from "zod";

// Order: alphabetic. Used as schema-canonical ordering for derived
// CLI error messages and --help text. Do not reorder.
export const agentIdSchema = z.enum([
  "aider",
  "claude-code",
  "codex",
  "continue",
  "cursor",
  "gemini",
  "generic-cli",
  "windsurf",
]);

export type AgentId = z.infer<typeof agentIdSchema>;
