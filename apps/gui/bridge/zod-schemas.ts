import { memoryScopeSchema } from "@megasaver/core";
import {
  titleSchema as TITLE_SCHEMA,
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
  tokenSaverModeSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const ENABLE_TOKEN_SAVER_BODY = z
  .object({
    mode: tokenSaverModeSchema.optional(),
    maxReturnedBytes: z.number().int().positive().optional(),
    storeRawOutput: z.boolean().optional(),
    redactSecrets: z.boolean().optional(),
    autoRepair: z.boolean().optional(),
  })
  .strict();

export const DISABLE_TOKEN_SAVER_BODY = z.object({}).strict();

export const CREATE_SESSION_BODY = z
  .object({
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    title: TITLE_SCHEMA.optional(),
    riskLevel: riskLevelSchema.optional().default("medium"),
  })
  .strict();

export const END_SESSION_BODY = z
  .object({
    endedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

// PATCH body — subset of sessionUpdatePatchSchema (cannot import via cross-file
// because we need a tweaked title check that allows null and empty-string-as-null).
export const PATCH_SESSION_BODY = z
  .object({
    title: TITLE_SCHEMA.nullable().optional(),
    riskLevel: riskLevelSchema.optional(),
    agentId: agentIdSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "PATCH body must contain at least one of title, riskLevel, agentId.",
  });

export const CREATE_MEMORY_BODY = z
  .object({
    projectId: projectIdSchema,
    content: z.string().trim().min(1),
    scope: memoryScopeSchema,
    sessionId: sessionIdSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }
    if (entry.scope === "project" && entry.sessionId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

export function zodErrorMessage(err: z.ZodError): string {
  const first = err.issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : "Validation failed.";
}
