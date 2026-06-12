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

// Partial update over the MUTABLE fields only (mirrors memoryEntryUpdatePatchSchema).
// id/projectId/sessionId/task/failedStep/relatedFiles/createdAt are immutable
// after create; `.strict()` rejects them.
export const failedAttemptPatchSchema = z
  .object({
    convertedToRule: z.boolean().optional(),
    resolution: z.string().trim().min(1).optional(),
    suspectedCause: z.string().trim().min(1).optional(),
  })
  .strict();

export type FailedAttemptPatch = z.infer<typeof failedAttemptPatchSchema>;

// Deterministic evidence line linking a derived rule back to its source failure.
export function seedFailureEvidence(failure: FailedAttempt): string {
  return `Derived from failed attempt ${failure.id} (${failure.createdAt}): ${failure.failedStep} — ${failure.errorOutput ?? "no error output"}`;
}
