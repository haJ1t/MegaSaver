import { failedAttemptIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const failedAttemptSchema = z
  .object({
    id: failedAttemptIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    task: z.string().trim().min(1),
    failedStep: z.string().trim().min(1),
    errorOutput: z.string().trim().min(1).optional(),
    relatedFiles: z.array(z.string()).default([]),
    suspectedCause: z.string().trim().min(1).optional(),
    resolution: z.string().trim().min(1).optional(),
    convertedToRule: z.boolean().default(false),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type FailedAttempt = z.infer<typeof failedAttemptSchema>;
