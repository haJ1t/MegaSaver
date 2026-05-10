import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";
import { tokenSaverSettingsSchema } from "./token-saver.js";

export const sessionSchema = z
  .object({
    id: sessionIdSchema,
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    riskLevel: riskLevelSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .transform((value) => value.normalize("NFC"))
      .nullable(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    // AA1 BB1: optional per-session token-saver settings. Absent on
    // pre-AA sessions (v0.4 fixture); writing this field is opt-in via
    // `mega session saver enable` (BB2) or the GUI panel (BB10).
    tokenSaver: tokenSaverSettingsSchema.optional(),
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;

export const sessionUpdatePatchSchema = z
  .object({
    title: z.string().nullable().optional(),
    riskLevel: riskLevelSchema.optional(),
    agentId: agentIdSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "patch must contain at least one field",
  });

export type SessionUpdatePatch = z.infer<typeof sessionUpdatePatchSchema>;
