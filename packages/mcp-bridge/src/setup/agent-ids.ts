import { z } from "zod";

// Mirrors apps/cli/src/known-targets.ts KnownTargetId. Declared
// here so mcp-bridge does not import the CLI (dependency arrow,
// CLAUDE.md §8). The CLI validates against KNOWN_TARGET_IDS and
// passes a validated id in.
export const knownAgentIdSchema = z.enum(["claude-code", "codex", "cursor", "aider"]);
export type KnownAgentId = z.infer<typeof knownAgentIdSchema>;
