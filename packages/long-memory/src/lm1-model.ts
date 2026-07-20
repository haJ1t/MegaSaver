import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import {
  LM1_SCHEMA_VERSION,
  MAX_LM1_EVIDENCE_IDS,
  lowercaseUuidSchema,
  preparedSnapshotSchema,
  preparedTransitionSchema,
  sha256Schema,
  validateCanonicalCaptureFields,
} from "./lm1-capture-model.js";

export {
  LM1_SCHEMA_VERSION,
  MAX_LM1_ACTION_CODE_UNITS,
  MAX_LM1_EVIDENCE_IDS,
  MAX_LM1_STATE_KEY_CODE_UNITS,
  MAX_LM1_TEXT_CODE_UNITS,
  prepareCapture,
  prepareCaptureInputSchema,
  preparedCaptureSchema,
  type PrepareCaptureInput,
  type PreparedCapture,
  type RedactionPort,
} from "./lm1-capture-model.js";
export const MAX_LM1_RECALL_TASK_CODE_UNITS = 20_000;
export const MAX_LM1_RECALL_TOKEN_BUDGET = 100_000;

export const lm1KindSchema = z.enum(["state_snapshot", "state_transition"]);
export type Lm1Kind = z.infer<typeof lm1KindSchema>;

const commonRecordShape = {
  id: lowercaseUuidSchema,
  sourceDigest: sha256Schema,
  evidenceBindingDigest: sha256Schema,
  recordedAt: z.string().datetime({ offset: true }),
  evidenceDigests: z.array(sha256Schema).min(1).max(MAX_LM1_EVIDENCE_IDS),
  status: z.literal("recorded"),
};
const snapshotRecordSchema = preparedSnapshotSchema.extend(commonRecordShape);
const transitionRecordSchema = preparedTransitionSchema.extend(commonRecordShape);
export const lm1RecordSchema = z
  .discriminatedUnion("kind", [snapshotRecordSchema, transitionRecordSchema])
  .superRefine((record, context) => {
    validateCanonicalCaptureFields(record, context);
    if (record.evidenceDigests.length !== record.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        message: "evidence digests must match evidence ids",
        path: ["evidenceDigests"],
      });
    }
  });
export type Lm1Record = z.infer<typeof lm1RecordSchema>;
export type Lm1Snapshot = Extract<Lm1Record, { kind: "state_snapshot" }>;
export type Lm1Transition = Extract<Lm1Record, { kind: "state_transition" }>;

export const lm1RecallRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    task: z.string().trim().min(1).max(MAX_LM1_RECALL_TASK_CODE_UNITS),
    tokenBudget: z.number().int().min(1).max(MAX_LM1_RECALL_TOKEN_BUDGET),
  })
  .strict();
export type Lm1RecallRequest = z.infer<typeof lm1RecallRequestSchema>;

export type Lm1RecallBundle = {
  items: readonly { type: "text"; value: string; observationId: string }[];
  receipt: {
    selected: readonly { id: string; score: number; tokenCount: number }[];
    omitted: readonly { id: string; reason: string }[];
    scannedRecordCount: number;
    candidateCount: number;
    evidenceLookupCount: number;
  };
};

const evidenceBindingEntrySchema = z
  .object({
    evidenceId: lowercaseUuidSchema,
    evidenceDigest: sha256Schema,
  })
  .strict();
export const evidenceBindingResultSchema = z
  .object({ evidence: z.array(evidenceBindingEntrySchema).min(1).max(MAX_LM1_EVIDENCE_IDS) })
  .strict();
export type EvidenceBinding = z.infer<typeof evidenceBindingResultSchema>;

export type EvidenceBindingPort = {
  verify(input: {
    workspaceKey: string;
    canonicalCaptureDigest: string;
    evidenceIds: readonly string[];
    authorization: string;
  }): Promise<EvidenceBinding | null>;
};

const evidenceEligibilityEntrySchema = z
  .object({
    evidenceId: lowercaseUuidSchema,
    workspaceKey: workspaceKeySchema,
    status: z.enum(["available", "retained_metadata_only", "revoked"]),
    unresolvedHighRisk: z.boolean(),
  })
  .strict();
export const evidenceEligibilityResultSchema = z
  .array(evidenceEligibilityEntrySchema)
  .max(MAX_LM1_EVIDENCE_IDS * 3);
export type EvidenceEligibility = z.infer<typeof evidenceEligibilityResultSchema>;

export type EvidenceEligibilityPort = {
  resolve(input: {
    workspaceKey: string;
    evidenceIds: readonly string[];
  }): Promise<EvidenceEligibility>;
};
