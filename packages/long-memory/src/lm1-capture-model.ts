import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import { canonicalCaptureDigest } from "./lm1-identity.js";

export const LM1_SCHEMA_VERSION = 1 as const;
export const MAX_LM1_TEXT_CODE_UNITS = 50_000;
export const MAX_LM1_ACTION_CODE_UNITS = 5_000;
export const MAX_LM1_STATE_KEY_CODE_UNITS = 512;
export const MAX_LM1_EVIDENCE_IDS = 64;

export const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");
const textSchema = z.string().min(1).max(MAX_LM1_TEXT_CODE_UNITS);
const actionSchema = z.string().min(1).max(MAX_LM1_ACTION_CODE_UNITS);
const evidenceIdsSchema = z.array(lowercaseUuidSchema).min(1).max(MAX_LM1_EVIDENCE_IDS);

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

export const preparedSnapshotSchema = snapshotCaptureSchema.extend({
  schemaVersion: z.literal(LM1_SCHEMA_VERSION),
  redactionVersion: z.string().trim().min(1),
  canonicalCaptureDigest: sha256Schema,
});
export const preparedTransitionSchema = transitionCaptureSchema.extend({
  schemaVersion: z.literal(LM1_SCHEMA_VERSION),
  redactionVersion: z.string().trim().min(1),
  canonicalCaptureDigest: sha256Schema,
});

export function normalizeLm1Text(value: string): string {
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

export function validateCanonicalCaptureFields(
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
    capture.text !== normalizeLm1Text(capture.text) ||
    (capture.action !== null && capture.action !== normalizeLm1Text(capture.action)) ||
    capture.redactionVersion !== normalizeLm1Text(capture.redactionVersion) ||
    (capture.stateKey !== undefined && capture.stateKey !== normalizeLm1Text(capture.stateKey)) ||
    (capture.recordedAt !== undefined && !isCanonicalDate(capture.recordedAt))
  ) {
    context.addIssue({ code: "custom", message: "capture fields must be normalized" });
  }
}

export const preparedCaptureSchema = z
  .discriminatedUnion("kind", [preparedSnapshotSchema, preparedTransitionSchema])
  .superRefine(validateCanonicalCaptureFields);
export type PreparedCapture = z.infer<typeof preparedCaptureSchema>;

export type RedactionPort = {
  version: string;
  redact(input: { text: string; action: string | null }): {
    text: string;
    action: string | null;
    unresolvedHighRisk: boolean;
  };
};

const redactionResultSchema = z
  .object({ text: z.string(), action: z.string().nullable(), unresolvedHighRisk: z.boolean() })
  .strict();
const redactionVersionSchema = z.string().trim().min(1);

function parseInput(input: PrepareCaptureInput): PrepareCaptureInput {
  try {
    const parsed = prepareCaptureInputSchema.safeParse(input);
    if (parsed.success) return parsed.data;
  } catch {}
  throw new Lm1Error("invalid_input", "Invalid LM1 capture input.");
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
  let version: unknown;
  try {
    version = redactor.version;
  } catch (error) {
    mapRedactorError(error);
  }
  const redactionVersion = redactionVersionSchema.safeParse(version);
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
    text: normalizeLm1Text(redacted.data.text),
    action: redacted.data.action === null ? null : normalizeLm1Text(redacted.data.action),
    evidenceIds: [...new Set(parsed.evidenceIds)].sort(),
    ...(parsed.kind === "state_snapshot" ? { stateKey: normalizeLm1Text(parsed.stateKey) } : {}),
  };
  const unsigned = {
    ...normalized,
    schemaVersion: LM1_SCHEMA_VERSION,
    redactionVersion: normalizeLm1Text(redactionVersion.data),
  };
  const result = preparedCaptureSchema.safeParse({
    ...unsigned,
    canonicalCaptureDigest: canonicalCaptureDigest(unsigned as PreparedCapture),
  });
  if (!result.success) {
    throw new Lm1Error(
      "store_corrupt",
      "Long-memory redaction adapter returned invalid capture fields.",
    );
  }
  return result.data;
}
