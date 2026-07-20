import { createHash } from "node:crypto";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";

export const MAX_LM2_MODEL_PROVIDER_CODE_UNITS = 128;
export const MAX_LM2_MODEL_ID_CODE_UNITS = 256;
export const MAX_LM2_MODEL_REVISION_CODE_UNITS = 256;
export const MAX_LM2_DIMENSIONS = 4_096;
export const MAX_LM2_ADMITTED_MODELS = 2;
export const MAX_LM2_QUERY_TIMEOUT_MS = 1_500;
export const MAX_LM2_INDEX_BATCH_TIMEOUT_MS = 15_000;
export const MAX_LM2_CANDIDATE_TEXT_CODE_UNITS = 50_000;
export const MAX_LM2_RANK_CANDIDATES = 10_000;
export const MAX_LM2_INDEX_RECORDS = 256;

const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");
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

export const lm2CandidateSchema = z
  .object({
    id: lowercaseUuidSchema,
    workspaceKey: workspaceKeySchema,
    observedAt: z.string().datetime({ offset: true }),
    kind: z.enum(["state_snapshot", "state_transition"]),
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

export const lm2IndexReceiptSchema = z
  .object({
    indexedCount: z.number().int().nonnegative().max(MAX_LM2_INDEX_RECORDS),
    omitted: z.array(
      z.object({ id: lowercaseUuidSchema, reason: z.string().trim().min(1) }).strict(),
    ),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type Lm2IndexReceipt = z.infer<typeof lm2IndexReceiptSchema>;

const remoteApprovalSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    modelFingerprint: sha256Schema,
    approvalRef: z.string().trim().min(1).max(4_096),
  })
  .strict();

function canonicalModelFingerprint(model: ModelDescriptor): string {
  const canonicalModel = Object.fromEntries(
    Object.entries(model).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256").update(JSON.stringify(canonicalModel), "utf8").digest("hex");
}

export const lm2RuntimeConfigSchema = z
  .object({
    admittedModels: z.array(modelDescriptorSchema).min(1).max(MAX_LM2_ADMITTED_MODELS),
    embeddingEgress: embeddingEgressSchema,
    remoteApprovals: z.array(remoteApprovalSchema).max(MAX_LM2_ADMITTED_MODELS),
    queryTimeoutMs: z.number().int().min(1).max(MAX_LM2_QUERY_TIMEOUT_MS),
    indexBatchTimeoutMs: z.number().int().min(1).max(MAX_LM2_INDEX_BATCH_TIMEOUT_MS),
  })
  .strict()
  .superRefine((config, context) => {
    const admittedFingerprints = config.admittedModels.map(canonicalModelFingerprint);
    const admittedFingerprintSet = new Set(admittedFingerprints);
    if (admittedFingerprintSet.size !== admittedFingerprints.length) {
      context.addIssue({ code: "custom", message: "admitted models must be unique" });
    }
    if (config.embeddingEgress === "local" && config.remoteApprovals.length > 0) {
      context.addIssue({ code: "custom", message: "local egress cannot have remote approvals" });
    }
    const approvalKeys = new Set<string>();
    for (const approval of config.remoteApprovals) {
      if (!admittedFingerprintSet.has(approval.modelFingerprint)) {
        context.addIssue({
          code: "custom",
          message: "remote approval must reference an admitted model",
          path: ["remoteApprovals"],
        });
      }
      const approvalKey = `${approval.workspaceKey}\0${approval.modelFingerprint}`;
      if (approvalKeys.has(approvalKey)) {
        context.addIssue({
          code: "custom",
          message: "remote approvals must be unique",
          path: ["remoteApprovals"],
        });
      }
      approvalKeys.add(approvalKey);
    }
  });
export type Lm2RuntimeConfig = z.infer<typeof lm2RuntimeConfigSchema>;

const semanticReasonSchema = z.enum([
  "missing_vectors",
  "port_failure",
  "invalid_vectors",
  "timeout",
  "input_limit",
  "storage_limit",
  "vector_read_limit",
  "remote_approval_denied",
]);
export type HybridSemanticReason = z.infer<typeof semanticReasonSchema>;

export const hybridReceiptSchema = z
  .object({
    profile: lm2ProfileSchema,
    adaptiveCandidateScope: z.enum(["not_applicable", "lm2_capture_window", "benchmark_run_cache"]),
    adaptiveCatalogRecordCount: z.number().int().nonnegative(),
    candidateInputOmittedCount: z.number().int().nonnegative(),
    lexicalCandidateCount: z.number().int().nonnegative().max(1_000),
    semanticCandidateCount: z.number().int().nonnegative().max(1_000),
    fusedCandidateCount: z.number().int().nonnegative().max(1_000),
    semanticStatus: z.enum(["not_requested", "used", "used_partial_index", "degraded"]),
    semanticReasons: z.array(semanticReasonSchema),
    indexedVectorCount: z.number().int().nonnegative(),
    missingVectorCount: z.number().int().nonnegative(),
    invalidVectorCount: z.number().int().nonnegative(),
    semanticVectorBytesRead: z.number().int().nonnegative(),
    queryLatencyMs: z.number().nonnegative(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const sortedReasons = [...new Set(receipt.semanticReasons)].sort();
    const requiresReasons =
      receipt.semanticStatus === "used_partial_index" || receipt.semanticStatus === "degraded";
    if (
      (requiresReasons && receipt.semanticReasons.length === 0) ||
      (!requiresReasons && receipt.semanticReasons.length !== 0) ||
      sortedReasons.length !== receipt.semanticReasons.length ||
      sortedReasons.some((reason, index) => reason !== receipt.semanticReasons[index])
    ) {
      context.addIssue({ code: "custom", message: "semantic reasons must match semantic status" });
    }
  });
export type HybridReceipt = z.infer<typeof hybridReceiptSchema>;

export type EmbeddingPort = {
  egress: EmbeddingEgress;
  embed(input: {
    model: ModelDescriptor;
    purpose: EmbeddingPurpose;
    texts: readonly string[];
    signal: AbortSignal;
  }): Promise<{ modelFingerprint: string; vectors: readonly (readonly number[])[] }>;
};

export type RemoteEmbeddingApprovalPort = {
  assertCurrent(input: {
    workspaceKey: string;
    modelFingerprint: string;
    purpose: EmbeddingPurpose;
    approvalRef: string;
  }): Promise<"approved" | "denied" | "revoked" | "unreadable">;
};
