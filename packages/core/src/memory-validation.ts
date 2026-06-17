import { memoryEntryIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { validationStatusSchema } from "./validation-status.js";

export const memoryValidationSchema = z
  .object({
    memoryEntryId: memoryEntryIdSchema,
    validationStatus: validationStatusSchema,
    reasons: z.array(z.string()),
    conflictIds: z.array(memoryEntryIdSchema),
    validatedAt: z.string().datetime({ offset: true }),
    validatedBy: z.enum(["system", "human"]),
    policyVersion: z.string().min(1),
  })
  .strict();

export type MemoryValidation = z.infer<typeof memoryValidationSchema>;
