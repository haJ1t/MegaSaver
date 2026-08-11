import { MAX_LM2_CANDIDATE_TEXT_CODE_UNITS } from "@megasaver/long-memory/ranker";
import { sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const contractEvidenceSchema = z
  .object({
    kind: z.enum(["memory-entry-ref", "file-ref", "keyword"]),
    value: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type ContractEvidence = z.infer<typeof contractEvidenceSchema>;

// name doubles as the fixture filename stem — the slug regex is the
// path-escape guard, so keep it strict.
export const contractSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    intent: z.string().trim().min(1).max(MAX_LM2_CANDIDATE_TEXT_CODE_UNITS),
    requiredEvidence: z.array(contractEvidenceSchema).min(1).max(32),
    tokenBudget: z.number().int().positive().max(100_000),
    createdFrom: sessionIdSchema.nullable(),
  })
  .strict();

export type Contract = z.infer<typeof contractSchema>;
