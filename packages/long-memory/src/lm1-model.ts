import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import { type Sha256, canonicalCaptureDigest } from "./lm1-identity.js";

export const LM1_SCHEMA_VERSION = 1 as const;
export const MAX_LM1_TEXT_CODE_UNITS = 50_000;
export const MAX_LM1_ACTION_CODE_UNITS = 5_000;
export const MAX_LM1_STATE_KEY_CODE_UNITS = 512;
export const MAX_LM1_EVIDENCE_IDS = 64;

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
export const preparedCaptureSchema = z
  .discriminatedUnion("kind", [preparedSnapshotSchema, preparedTransitionSchema])
  .superRefine((capture, context) => {
    const sorted = [...new Set(capture.evidenceIds)].sort();
    if (
      sorted.length !== capture.evidenceIds.length ||
      sorted.some((id, index) => id !== capture.evidenceIds[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "evidenceIds must be sorted and unique",
        path: ["evidenceIds"],
      });
    }
  });
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

function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

function normalizeDate(value: string): string {
  return new Date(value).toISOString();
}

function parseInput(input: PrepareCaptureInput): PrepareCaptureInput {
  const parsed = prepareCaptureInputSchema.safeParse(input);
  if (!parsed.success) throw new Lm1Error("invalid_input", "Invalid LM1 capture input.");
  return parsed.data;
}

export function prepareCapture(
  input: PrepareCaptureInput,
  redactor: RedactionPort,
): PreparedCapture {
  const parsed = parseInput(input);
  const redacted = redactor.redact({ text: parsed.text, action: parsed.action });
  if (redacted.unresolvedHighRisk) {
    throw new Lm1Error("invalid_input", "Unresolved high-risk content.");
  }

  const normalized = {
    ...parsed,
    observedAt: normalizeDate(parsed.observedAt),
    text: normalizeText(redacted.text),
    action: redacted.action === null ? null : normalizeText(redacted.action),
    evidenceIds: [...new Set(parsed.evidenceIds)].sort(),
    ...(parsed.kind === "state_snapshot" ? { stateKey: normalizeText(parsed.stateKey) } : {}),
  };
  const redactionVersion = normalizeText(redactor.version);
  const unsigned = { ...normalized, schemaVersion: LM1_SCHEMA_VERSION, redactionVersion };
  const canonicalDigest = canonicalCaptureDigest(unsigned as PreparedCapture);
  const result = preparedCaptureSchema.safeParse({
    ...unsigned,
    canonicalCaptureDigest: canonicalDigest,
  });
  if (!result.success) throw new Lm1Error("invalid_input", "Invalid redacted LM1 capture.");
  return result.data;
}

export type Lm1RecallRequest = {
  workspaceKey: string;
  task: string;
  tokenBudget: number;
};

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

export type EvidenceBindingPort = {
  verify(input: {
    workspaceKey: string;
    canonicalCaptureDigest: Sha256;
    evidenceIds: readonly string[];
    authorization: string;
  }): Promise<{ evidenceDigests: readonly Sha256[] } | null>;
};

export type EvidenceEligibilityPort = {
  resolve(input: {
    workspaceKey: string;
    evidenceIds: readonly string[];
  }): Promise<
    readonly {
      evidenceId: string;
      workspaceKey: string;
      status: "available" | "retained_metadata_only" | "revoked";
      unresolvedHighRisk: boolean;
    }[]
  >;
};
