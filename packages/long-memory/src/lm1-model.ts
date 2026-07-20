import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import { type Sha256, canonicalCaptureDigest } from "./lm1-identity.js";

export const LM1_SCHEMA_VERSION = 1 as const;
export const MAX_LM1_TEXT_CODE_UNITS = 50_000;
export const MAX_LM1_ACTION_CODE_UNITS = 5_000;
export const MAX_LM1_STATE_KEY_CODE_UNITS = 512;
export const MAX_LM1_EVIDENCE_IDS = 64;
export const MAX_LM1_RECALL_TASK_CODE_UNITS = 20_000;
export const MAX_LM1_RECALL_TOKEN_BUDGET = 100_000;

const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");
const textSchema = z.string().min(1).max(MAX_LM1_TEXT_CODE_UNITS);
const actionSchema = z.string().min(1).max(MAX_LM1_ACTION_CODE_UNITS);
const evidenceIdsSchema = z.array(lowercaseUuidSchema).min(1).max(MAX_LM1_EVIDENCE_IDS);

export const lm1KindSchema = z.enum(["state_snapshot", "state_transition"]);
export type Lm1Kind = z.infer<typeof lm1KindSchema>;

const snapshotCaptureSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    kind: z.literal("state_snapshot"),
    observedAt: z.string().datetime({ offset: true }),
    text: textSchema,
    action: z.null(),
    evidenceIds: evidenceIdsSchema,
    stateKey: z.string().min(1).max(MAX_LM1_STATE_KEY_CODE_UNITS),
    representation: z.enum(["value", "absence", "config", "code"]),
    supersedesSnapshotId: lowercaseUuidSchema.nullable(),
  })
  .strict();
const transitionCaptureSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    kind: z.literal("state_transition"),
    observedAt: z.string().datetime({ offset: true }),
    text: textSchema,
    action: actionSchema,
    evidenceIds: evidenceIdsSchema,
    preSnapshotId: lowercaseUuidSchema,
    postSnapshotId: lowercaseUuidSchema,
    outcome: z.enum(["applied", "failed", "contradicted"]),
  })
  .strict();

export const prepareCaptureInputSchema = z.discriminatedUnion("kind", [
  snapshotCaptureSchema,
  transitionCaptureSchema,
]);
export type PrepareCaptureInput = z.infer<typeof prepareCaptureInputSchema>;

const preparedSnapshotSchema = snapshotCaptureSchema.extend({
  schemaVersion: z.literal(LM1_SCHEMA_VERSION),
  redactionVersion: z.string().trim().min(1),
  canonicalCaptureDigest: sha256Schema,
});
const preparedTransitionSchema = transitionCaptureSchema.extend({
  schemaVersion: z.literal(LM1_SCHEMA_VERSION),
  redactionVersion: z.string().trim().min(1),
  canonicalCaptureDigest: sha256Schema,
});

function validateCanonicalCaptureFields(
  capture: {
    evidenceIds: readonly string[];
    observedAt: string;
    text: string;
    action: string | null;
    redactionVersion: string;
    stateKey?: string;
    recordedAt?: string;
  },
  context: z.RefinementCtx,
): void {
  const sortedEvidenceIds = [...new Set(capture.evidenceIds)].sort();
  if (
    sortedEvidenceIds.length !== capture.evidenceIds.length ||
    sortedEvidenceIds.some((id, index) => id !== capture.evidenceIds[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "evidenceIds must be sorted and unique",
      path: ["evidenceIds"],
    });
  }
  if (
    !isCanonicalDate(capture.observedAt) ||
    capture.text !== normalizeText(capture.text) ||
    (capture.action !== null && capture.action !== normalizeText(capture.action)) ||
    capture.redactionVersion !== normalizeText(capture.redactionVersion) ||
    (capture.stateKey !== undefined && capture.stateKey !== normalizeText(capture.stateKey)) ||
    (capture.recordedAt !== undefined && !isCanonicalDate(capture.recordedAt))
  ) {
    context.addIssue({
      code: "custom",
      message: "capture fields must be normalized",
    });
  }
}

export const preparedCaptureSchema = z
  .discriminatedUnion("kind", [preparedSnapshotSchema, preparedTransitionSchema])
  .superRefine(validateCanonicalCaptureFields);
export type PreparedCapture = z.infer<typeof preparedCaptureSchema>;

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

export type RedactionPort = {
  version: string;
  redact(input: { text: string; action: string | null }): {
    text: string;
    action: string | null;
    unresolvedHighRisk: boolean;
  };
};

const redactionResultSchema = z
  .object({
    text: z.string(),
    action: z.string().nullable(),
    unresolvedHighRisk: z.boolean(),
  })
  .strict();
const redactionVersionSchema = z.string().trim().min(1);

function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

function normalizeDate(value: string): string {
  return new Date(value).toISOString();
}

function isCanonicalDate(value: string): boolean {
  try {
    return value === normalizeDate(value);
  } catch {
    return false;
  }
}

function parseInput(input: PrepareCaptureInput): PrepareCaptureInput {
  let parsed: ReturnType<typeof prepareCaptureInputSchema.safeParse>;
  try {
    parsed = prepareCaptureInputSchema.safeParse(input);
  } catch {
    throw new Lm1Error("invalid_input", "Invalid LM1 capture input.");
  }
  if (!parsed.success) throw new Lm1Error("invalid_input", "Invalid LM1 capture input.");
  return parsed.data;
}

function mapRedactorError(error: unknown): never {
  void error;
  throw new Lm1Error("store_corrupt", "Long-memory redaction adapter failed.");
}

export function prepareCapture(
  input: PrepareCaptureInput,
  redactor: RedactionPort,
): PreparedCapture {
  const parsed = parseInput(input);
  let redactorResult: unknown;
  try {
    redactorResult = redactor.redact({ text: parsed.text, action: parsed.action });
  } catch (error) {
    mapRedactorError(error);
  }
  let redacted: ReturnType<typeof redactionResultSchema.safeParse>;
  try {
    redacted = redactionResultSchema.safeParse(redactorResult);
  } catch (error) {
    mapRedactorError(error);
  }
  if (!redacted.success) {
    throw new Lm1Error(
      "store_corrupt",
      "Long-memory redaction adapter returned an invalid result.",
    );
  }
  let redactorVersion: unknown;
  try {
    redactorVersion = redactor.version;
  } catch (error) {
    mapRedactorError(error);
  }
  const redactionVersion = redactionVersionSchema.safeParse(redactorVersion);
  if (!redactionVersion.success) {
    throw new Lm1Error("store_corrupt", "Long-memory redaction adapter has an invalid version.");
  }
  if (redacted.data.unresolvedHighRisk) {
    throw new Lm1Error("invalid_input", "Unresolved high-risk content.");
  }

  let observedAt: string;
  try {
    observedAt = normalizeDate(parsed.observedAt);
  } catch {
    throw new Lm1Error("invalid_input", "Invalid LM1 capture input.");
  }
  const normalized = {
    ...parsed,
    observedAt,
    text: normalizeText(redacted.data.text),
    action: redacted.data.action === null ? null : normalizeText(redacted.data.action),
    evidenceIds: [...new Set(parsed.evidenceIds)].sort(),
    ...(parsed.kind === "state_snapshot" ? { stateKey: normalizeText(parsed.stateKey) } : {}),
  };
  const unsigned = {
    ...normalized,
    schemaVersion: LM1_SCHEMA_VERSION,
    redactionVersion: normalizeText(redactionVersion.data),
  };
  const canonicalDigest = canonicalCaptureDigest(unsigned as PreparedCapture);
  const result = preparedCaptureSchema.safeParse({
    ...unsigned,
    canonicalCaptureDigest: canonicalDigest,
  });
  if (!result.success) {
    throw new Lm1Error(
      "store_corrupt",
      "Long-memory redaction adapter returned invalid capture fields.",
    );
  }
  return result.data;
}

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
