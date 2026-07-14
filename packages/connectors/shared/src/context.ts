import { memoryEntrySchema, projectSchema, sessionSchema } from "@megasaver/core";
import { agentIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { ConnectorError } from "./errors.js";
import { containsSentinel } from "./sentinel-guard.js";

export const ConnectorContextSchema = z
  .object({
    agentId: agentIdSchema,
    project: projectSchema,
    session: sessionSchema.nullable(),
    memoryEntries: z.array(memoryEntrySchema),
    // Response/render-only data (never persisted), keyed by memory entry id:
    // the CLOSED predecessor's title/closedAt for the "changed from" suffix.
    memoryChangedFrom: z
      .record(z.object({ title: z.string(), closedAt: z.string(), reason: z.string().optional() }))
      .optional(),
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
      if (context.session.agentId !== context.agentId) {
        ctx.addIssue({
          code: "custom",
          message: "Session agent must match context agent.",
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
      // title crosses the same render boundary as content (and shows in
      // explain/show); guard it against sentinel injection too, even though
      // the current renderer emits only content.
      if (containsSentinel(entry.title)) {
        ctx.addIssue({
          code: "custom",
          message: "Memory entry title cannot contain Mega Saver sentinels.",
          path: ["memoryEntries", index, "title"],
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

    // The predecessor named by changedFrom is filtered OUT of memoryEntries
    // (closed rows are not recallable), so its agent-controlled title reaches
    // the rendered block only through this record — guard it like the entries.
    for (const [id, changedFrom] of Object.entries(context.memoryChangedFrom ?? {})) {
      if (containsSentinel(changedFrom.title)) {
        ctx.addIssue({
          code: "custom",
          message: "Changed-from title cannot contain Mega Saver sentinels.",
          path: ["memoryChangedFrom", id, "title"],
        });
      }
    }
  });

export type ConnectorContext = z.infer<typeof ConnectorContextSchema>;

export function assertConnectorContext(input: unknown): ConnectorContext {
  const parsed = ConnectorContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConnectorError("context_invalid", "Connector context is invalid.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
