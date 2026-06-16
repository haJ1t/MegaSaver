import { memoryEntryIdSchema, workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import {
  evidenceStatusSchema,
  retentionClassSchema,
  revocationReasonSchema,
  sourceKindSchema,
} from "./enums.js";
import {
  isScrubbedSourceRef,
  redactionReportSchema,
  returnedChunkRefSchema,
  sessionRefSchema,
  sourceRefSchema,
  transitionSchema,
} from "./sub-schemas.js";

const lowercaseUuid = z
  .string()
  .uuid()
  .refine((v) => v === v.toLowerCase(), "id must be lowercase");

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");

export const evidenceRecordSchema = z
  .object({
    evidenceId: lowercaseUuid,
    workspaceKey: workspaceKeySchema,
    sessionRef: sessionRefSchema,
    sourceKind: sourceKindSchema,
    sourceRef: sourceRefSchema,
    classification: z.string().min(1),
    redactionReport: redactionReportSchema,
    rawDigest: sha256Hex.nullable(),
    returnedDigest: sha256Hex.nullable(),
    redactedRawChunkSetId: z.string().min(1).nullable(),
    returnedChunkRefs: z.array(returnedChunkRefSchema),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    retentionClass: retentionClassSchema,
    pinnedByMemoryIds: z.array(memoryEntryIdSchema),
    status: evidenceStatusSchema,
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    revocationReason: revocationReasonSchema.nullable(),
    policyVersion: z.string().min(1),
    pipelineVersion: z.string().min(1),
    transitions: z.array(transitionSchema).min(1),
  })
  .strict()
  .superRefine((rec, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: "custom", message, path });
    };

    if (rec.status === "available") {
      if (rec.redactedRawChunkSetId === null) {
        issue("available evidence must reference a raw chunk set.", ["redactedRawChunkSetId"]);
      }
      if (rec.rawDigest === null || rec.returnedDigest === null) {
        issue("available evidence must carry both digests.", ["rawDigest"]);
      }
    }

    if (rec.status === "retained_metadata_only" && rec.redactedRawChunkSetId !== null) {
      issue("metadata-only evidence must not retain a raw chunk set reference.", ["redactedRawChunkSetId"]);
    }

    const isRevoked = rec.status === "revoked";
    if (isRevoked) {
      if (rec.revokedAt === null || rec.revocationReason === null) {
        issue("revoked evidence requires revokedAt and revocationReason.", ["revokedAt"]);
      }
      if (rec.rawDigest !== null || rec.returnedDigest !== null) {
        issue("revoked evidence must null both digests.", ["rawDigest"]);
      }
      if (rec.redactedRawChunkSetId !== null) {
        issue("revoked evidence must null the raw chunk reference.", ["redactedRawChunkSetId"]);
      }
      if (!isScrubbedSourceRef(rec.sourceRef)) {
        issue("revoked evidence must carry a scrubbed sourceRef.", ["sourceRef"]);
      }
      if (rec.pinnedByMemoryIds.length > 0 || rec.retentionClass === "pinned") {
        issue("revoked evidence must not be pinned.", ["retentionClass"]);
      }
    } else if (rec.revokedAt !== null || rec.revocationReason !== null) {
      issue("only revoked evidence may set revokedAt/revocationReason.", ["revocationReason"]);
    }

    if (rec.retentionClass === "pinned") {
      if (rec.status !== "available") {
        issue("pinned retention requires status available.", ["retentionClass"]);
      }
      if (rec.pinnedByMemoryIds.length === 0) {
        issue("pinned retention requires at least one pinnedByMemoryIds entry.", ["pinnedByMemoryIds"]);
      }
    }
  });

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

// Input accepted by appendEvidence. The caller supplies the POST-REDACTION
// content (the ledger computes digests over it — callers never pass digests),
// already-redacted sourceRef, and the chunk-set id it persisted to content-store.
// The ledger stamps status/transitions/lifecycle.
export type EvidenceRecordInput = Omit<
  EvidenceRecord,
  | "rawDigest"
  | "returnedDigest"
  | "status"
  | "revokedAt"
  | "revocationReason"
  | "transitions"
  | "pinnedByMemoryIds"
> & {
  redactedRawContent: string;
  redactedReturnedContent: string;
};
