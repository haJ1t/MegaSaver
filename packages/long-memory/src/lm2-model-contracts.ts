import { z } from "zod";

export const MAX_LM2_MODEL_PROVIDER_CODE_UNITS = 128;
export const MAX_LM2_MODEL_ID_CODE_UNITS = 256;
export const MAX_LM2_MODEL_REVISION_CODE_UNITS = 256;
export const MAX_LM2_DIMENSIONS = 4_096;
export const MAX_LM2_ADMITTED_MODELS = 2;
export const MAX_LM2_QUERY_TIMEOUT_MS = 1_500;
export const MAX_LM2_INDEX_BATCH_TIMEOUT_MS = 15_000;
export const MAX_LM2_CANDIDATE_TEXT_CODE_UNITS = 50_000;
export const MAX_LM2_CANDIDATE_CORPUS_UTF8_BYTES = 64 * 1024 * 1024;
export const MAX_LM2_RANK_CANDIDATES = 10_000;
export const MAX_LM2_INDEX_RECORDS = 256;

export const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");

const canonicalString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.normalize("NFC").trim(), "must be canonical");

export const modelDescriptorSchema = z
  .object({
    provider: canonicalString(MAX_LM2_MODEL_PROVIDER_CODE_UNITS),
    modelId: canonicalString(MAX_LM2_MODEL_ID_CODE_UNITS),
    revision: canonicalString(MAX_LM2_MODEL_REVISION_CODE_UNITS),
    dimensions: z.number().int().min(1).max(MAX_LM2_DIMENSIONS),
    embeddingInputVersion: z.literal("lm2-v1"),
  })
  .strict();
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

export const lm2ProfileSchema = z.enum(["safe", "adaptive"]);
export type Lm2Profile = z.infer<typeof lm2ProfileSchema>;

export const embeddingEgressSchema = z.enum(["local", "remote"]);
export type EmbeddingEgress = z.infer<typeof embeddingEgressSchema>;

export const embeddingPurposeSchema = z.enum(["document", "query"]);
export type EmbeddingPurpose = z.infer<typeof embeddingPurposeSchema>;
