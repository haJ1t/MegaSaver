import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const memoryScopeSchema = z.enum(["project", "session"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryEntrySchema = z
  .object({
    id: memoryEntryIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    scope: memoryScopeSchema,
    content: z.string().trim().min(1),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === null) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }

    if (entry.scope === "project" && entry.sessionId !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
