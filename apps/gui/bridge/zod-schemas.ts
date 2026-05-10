import { memoryScopeSchema } from "@megasaver/core";
import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

// Title schema mirrors apps/cli/src/commands/session/shared.ts (NFC + control-char
// ban). Held local here so the bridge does not depend on `@megasaver/cli`.
export const TITLE_SCHEMA = z
  .string()
  .trim()
  .min(1)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f\u2028\u2029]+$/)
  .transform((value) => value.normalize("NFC"));

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
