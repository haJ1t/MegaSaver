import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

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
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;

export const SessionUpdatePatchSchema = z
  .object({
    title: z.string().nullable().optional(),
    riskLevel: riskLevelSchema.optional(),
    agentId: agentIdSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "patch must contain at least one field",
  });

export type SessionUpdatePatch = z.infer<typeof SessionUpdatePatchSchema>;
