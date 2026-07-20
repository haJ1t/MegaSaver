import { createHash } from "node:crypto";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import {
  type EmbeddingEgress,
  type EmbeddingPurpose,
  MAX_LM2_ADMITTED_MODELS,
  MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
  MAX_LM2_QUERY_TIMEOUT_MS,
  type ModelDescriptor,
  embeddingEgressSchema,
  lm2ProfileSchema,
  modelDescriptorSchema,
  sha256Schema,
} from "./lm2-model-contracts.js";

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
    activeRecallModelFingerprint: sha256Schema,
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
    if (!admittedFingerprintSet.has(config.activeRecallModelFingerprint)) {
      context.addIssue({
        code: "custom",
        message: "active recall model must be admitted",
        path: ["activeRecallModelFingerprint"],
      });
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
  "quota_ledger_invalid",
  "quota_recovery_pending",
  "embedding_port_unreadable",
  "embedding_egress_mismatch",
  "approval_port_unreadable",
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
