import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import {
  MAX_LM2_CANDIDATE_TEXT_CODE_UNITS,
  MAX_LM2_DIMENSIONS,
  MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
  MAX_LM2_INDEX_RECORDS,
  MAX_LM2_QUERY_TIMEOUT_MS,
  MAX_LM2_RANK_CANDIDATES,
  lm2ProfileSchema,
  lowercaseUuidSchema,
  modelDescriptorSchema,
  sha256Schema,
} from "./lm2-model-contracts.js";

export {
  embeddingEgressSchema,
  embeddingPurposeSchema,
  lm2ProfileSchema,
  MAX_LM2_ADMITTED_MODELS,
  MAX_LM2_CANDIDATE_TEXT_CODE_UNITS,
  MAX_LM2_DIMENSIONS,
  MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
  MAX_LM2_INDEX_RECORDS,
  MAX_LM2_MODEL_ID_CODE_UNITS,
  MAX_LM2_MODEL_PROVIDER_CODE_UNITS,
  MAX_LM2_MODEL_REVISION_CODE_UNITS,
  MAX_LM2_QUERY_TIMEOUT_MS,
  MAX_LM2_RANK_CANDIDATES,
  modelDescriptorSchema,
} from "./lm2-model-contracts.js";
export type {
  EmbeddingEgress,
  EmbeddingPurpose,
  Lm2Profile,
  ModelDescriptor,
} from "./lm2-model-contracts.js";
export { hybridReceiptSchema, lm2RuntimeConfigSchema } from "./lm2-runtime-model.js";
export type {
  EmbeddingPort,
  HybridReceipt,
  HybridSemanticReason,
  Lm2RuntimeConfig,
  RemoteEmbeddingApprovalPort,
} from "./lm2-runtime-model.js";

export const lm2CandidateSchema = z
  .object({
    id: lowercaseUuidSchema,
    workspaceKey: workspaceKeySchema,
    observedAt: z.string().datetime({ offset: true }),
    kind: z.enum(["state_snapshot", "state_transition", "memory_entry"]),
    text: z.string().min(1).max(MAX_LM2_CANDIDATE_TEXT_CODE_UNITS),
    sourceDigest: sha256Schema,
  })
  .strict();
export type Lm2Candidate = z.infer<typeof lm2CandidateSchema>;

export const lm2RankRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    task: z.string().trim().min(1).max(MAX_LM2_CANDIDATE_TEXT_CODE_UNITS),
    profile: lm2ProfileSchema,
    model: modelDescriptorSchema.optional(),
    timeoutMs: z.number().int().min(1).max(MAX_LM2_QUERY_TIMEOUT_MS).optional(),
  })
  .strict();
export type Lm2RankRequest = z.infer<typeof lm2RankRequestSchema>;

export const lm2IndexRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    modelFingerprint: sha256Schema,
    maxRecords: z.number().int().min(1).max(MAX_LM2_INDEX_RECORDS),
    cursor: z.string().trim().min(1).max(4_096).optional(),
    timeoutMs: z.number().int().min(1).max(MAX_LM2_INDEX_BATCH_TIMEOUT_MS).optional(),
  })
  .strict();
export type Lm2IndexRequest = z.infer<typeof lm2IndexRequestSchema>;

const indexTransientReasonSchema = z.enum([
  "index_busy",
  "index_lock_unavailable",
  "quota_state_invalid",
  "evidence_cap_exhausted",
  "remote_approval_denied",
  "embedding_failure",
  "timeout",
  "sidecar_write_failed",
  "evidence_changed",
  "lock_integrity_lost",
]);
const quotaRecoverySchema = z.enum(["not_needed", "recovered_pending", "blocked_pending"]);
const indexReceiptFields = {
  indexedCount: z.number().int().nonnegative().max(MAX_LM2_INDEX_RECORDS),
  omitted: z
    .array(
      z.object({ id: lowercaseUuidSchema, reason: z.string().trim().min(1).max(128) }).strict(),
    )
    .max(1_024),
  quotaRecovery: quotaRecoverySchema,
};
const cursorSchema = z.string().trim().min(1).max(4_096);

export const lm2IndexOutcomeSchema = z.enum(["complete", "continue", "retry", "expired"]);
export type Lm2IndexOutcome = z.infer<typeof lm2IndexOutcomeSchema>;

export const lm2IndexReceiptSchema = z
  .discriminatedUnion("outcome", [
    z
      .object({
        ...indexReceiptFields,
        outcome: z.literal("complete"),
        nextCursor: z.null(),
        retryCursor: z.null(),
        transientReason: z.null(),
      })
      .strict(),
    z
      .object({
        ...indexReceiptFields,
        outcome: z.literal("continue"),
        nextCursor: cursorSchema,
        retryCursor: z.null(),
        transientReason: z.null(),
      })
      .strict(),
    z
      .object({
        ...indexReceiptFields,
        outcome: z.literal("retry"),
        nextCursor: z.null(),
        retryCursor: cursorSchema.nullable(),
        transientReason: indexTransientReasonSchema,
      })
      .strict(),
    z
      .object({
        ...indexReceiptFields,
        outcome: z.literal("expired"),
        nextCursor: z.null(),
        retryCursor: z.null(),
        transientReason: z.null(),
      })
      .strict(),
  ])
  .superRefine((receipt, context) => {
    if (
      receipt.quotaRecovery === "blocked_pending" &&
      (receipt.outcome !== "retry" || receipt.transientReason !== "quota_state_invalid")
    ) {
      context.addIssue({
        code: "custom",
        message: "blocked recovery requires a quota-state retry",
      });
    }
  });
export type Lm2IndexReceipt = z.infer<typeof lm2IndexReceiptSchema>;

const vectorDiagnosticReasonSchema = z.enum([
  "missing_vectors",
  "invalid_vectors",
  "vector_read_limit",
  "quota_ledger_invalid",
  "quota_recovery_pending",
]);
const lm2VerifiedVectorSchema = z
  .object({
    candidateId: lowercaseUuidSchema,
    vector: z.array(z.number().finite()).min(1).max(MAX_LM2_DIMENSIONS),
    decodedBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_LM2_DIMENSIONS * 4),
  })
  .strict()
  .refine((value) => value.decodedBytes === value.vector.length * 4, {
    message: "decoded bytes must match the vector dimension",
  });

export const lm2VectorReadResultSchema = z
  .object({
    vectors: z.array(lm2VerifiedVectorSchema).max(MAX_LM2_RANK_CANDIDATES),
    diagnostics: z
      .array(
        z
          .object({ candidateId: lowercaseUuidSchema, reason: vectorDiagnosticReasonSchema })
          .strict(),
      )
      .max(MAX_LM2_RANK_CANDIDATES),
  })
  .strict();
export type Lm2VectorReadResult = z.infer<typeof lm2VectorReadResultSchema>;
