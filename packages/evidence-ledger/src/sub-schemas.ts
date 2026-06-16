import { memoryEntryIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { transitionKindSchema } from "./enums.js";

// Secret-bearing fields: command, args, url, query, path. `label` is a
// non-reversible human tag and is the only field allowed to survive a scrub.
export const sourceRefSchema = z
  .object({
    path: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    query: z.string().min(1),
    url: z.string().min(1),
    hookTool: z.string().min(1),
    label: z.string().min(1),
  })
  .partial()
  .strict();
export type SourceRef = z.infer<typeof sourceRefSchema>;

const SECRET_BEARING_KEYS = ["path", "command", "args", "query", "url", "hookTool"] as const;

// A scrubbed sourceRef carries NONE of the secret-bearing fields (spec §4).
export function isScrubbedSourceRef(ref: SourceRef): boolean {
  return SECRET_BEARING_KEYS.every((k) => ref[k] === undefined);
}

// Returns a fixed constant rather than transforming the input: even a preserved
// `label` could carry a secret (callers set it freely), so we emit a known-safe
// value and discard the original ref entirely.
export function scrubSourceRef(): SourceRef {
  return { label: "redacted" };
}

export const sessionRefSchema = z
  .object({ kind: z.enum(["durable", "live"]), id: z.string().min(1) })
  .strict()
  .nullable();
export type SessionRef = z.infer<typeof sessionRefSchema>;

export const redactionReportSchema = z
  .object({
    redacted: z.boolean(),
    highRiskFindings: z.number().int().nonnegative(),
    unresolvedHighRisk: z.boolean(),
  })
  .strict();
export type RedactionReport = z.infer<typeof redactionReportSchema>;

export const returnedChunkRefSchema = z
  .object({ chunkSetId: z.string().min(1), chunkId: z.string().min(1) })
  .strict();
export type ReturnedChunkRef = z.infer<typeof returnedChunkRefSchema>;

export const transitionSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    kind: transitionKindSchema,
    actor: z.enum(["system", "human"]).optional(),
    reason: z.string().min(1).optional(),
    memoryId: memoryEntryIdSchema.optional(),
  })
  .strict();
export type Transition = z.infer<typeof transitionSchema>;
