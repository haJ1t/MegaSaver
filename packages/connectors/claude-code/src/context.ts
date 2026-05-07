import { ConnectorContextSchema } from "@megasaver/connectors-shared";
import { z } from "zod";
import { CLAUDE_CODE_AGENT_ID } from "./constants.js";
import { ClaudeCodeConnectorError } from "./errors.js";

export const ClaudeCodeContextSchema = ConnectorContextSchema.superRefine((context, ctx) => {
  if (context.agentId !== CLAUDE_CODE_AGENT_ID) {
    ctx.addIssue({
      code: "custom",
      message: "Context agent must be Claude Code.",
      path: ["agentId"],
    });
  }
});

export type ClaudeCodeContext = z.infer<typeof ClaudeCodeContextSchema>;

export function assertClaudeCodeContext(input: unknown): ClaudeCodeContext {
  const parsed = ClaudeCodeContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new ClaudeCodeConnectorError(
      "claude_md_context_invalid",
      "Claude Code context is invalid.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
