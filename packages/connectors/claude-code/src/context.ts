import { memoryEntrySchema, projectSchema, sessionSchema } from "@megasaver/core";
import { z } from "zod";
import {
  CLAUDE_CODE_AGENT_ID,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "./constants.js";
import { ClaudeCodeConnectorError } from "./errors.js";

const sentinels = [MEGA_SAVER_BLOCK_START, MEGA_SAVER_BLOCK_END] as const;

const containsSentinel = (value: string): boolean =>
  sentinels.some((sentinel) => value.includes(sentinel));

export const ClaudeCodeContextSchema = z
  .object({
    project: projectSchema,
    session: sessionSchema.nullable(),
    memoryEntries: z.array(memoryEntrySchema).max(20),
  })
  .strict()
  .superRefine((context, ctx) => {
    if (containsSentinel(context.project.name)) {
      ctx.addIssue({
        code: "custom",
        message: "Project name cannot contain Mega Saver sentinels.",
        path: ["project", "name"],
      });
    }

    if (context.session !== null) {
      if (context.session.projectId !== context.project.id) {
        ctx.addIssue({
          code: "custom",
          message: "Session must belong to the project.",
          path: ["session", "projectId"],
        });
      }

      if (context.session.agentId !== CLAUDE_CODE_AGENT_ID) {
        ctx.addIssue({
          code: "custom",
          message: "Session agent must be Claude Code.",
          path: ["session", "agentId"],
        });
      }

      if (context.session.title !== null && containsSentinel(context.session.title)) {
        ctx.addIssue({
          code: "custom",
          message: "Session title cannot contain Mega Saver sentinels.",
          path: ["session", "title"],
        });
      }
    }

    context.memoryEntries.forEach((entry, index) => {
      if (entry.projectId !== context.project.id) {
        ctx.addIssue({
          code: "custom",
          message: "Memory entry must belong to the project.",
          path: ["memoryEntries", index, "projectId"],
        });
      }

      if (containsSentinel(entry.content)) {
        ctx.addIssue({
          code: "custom",
          message: "Memory entry content cannot contain Mega Saver sentinels.",
          path: ["memoryEntries", index, "content"],
        });
      }

      if (entry.scope === "session") {
        if (context.session === null) {
          ctx.addIssue({
            code: "custom",
            message: "Session-scoped memory requires a matching session.",
            path: ["memoryEntries", index, "sessionId"],
          });
        } else if (entry.sessionId !== context.session.id) {
          ctx.addIssue({
            code: "custom",
            message: "Session-scoped memory must belong to the session.",
            path: ["memoryEntries", index, "sessionId"],
          });
        }
      }
    });
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
