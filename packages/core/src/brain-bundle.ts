import { createHash } from "node:crypto";
import { z } from "zod";
import { failedAttemptSchema } from "./failed-attempt.js";
import { memoryEntrySchema } from "./memory-entry.js";
import { projectRuleSchema } from "./project-rule.js";

export const BRAIN_SCHEMA_VERSION = "1";

export type BrainBundleErrorCode = "malformed" | "hash_mismatch" | "unsupported_version";

export class BrainBundleError extends Error {
  readonly code: BrainBundleErrorCode;

  constructor(code: BrainBundleErrorCode, message: string) {
    super(message);
    this.name = "BrainBundleError";
    this.code = code;
  }
}

export const brainManifestSchema = z
  .object({
    schemaVersion: z.literal(BRAIN_SCHEMA_VERSION),
    kind: z.literal("megabrain"),
    sourceProject: z.object({ id: z.string().uuid(), name: z.string().trim().min(1) }).strict(),
    createdAt: z.string().datetime({ offset: true }),
    counts: z
      .object({
        memories: z.number().int().nonnegative(),
        rules: z.number().int().nonnegative(),
        failures: z.number().int().nonnegative(),
      })
      .strict(),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    redactionFindings: z.number().int().nonnegative(),
  })
  .strict();
export type BrainManifest = z.infer<typeof brainManifestSchema>;

export const brainPayloadSchema = z
  .object({
    memories: z.array(memoryEntrySchema),
    rules: z.array(projectRuleSchema),
    failures: z.array(failedAttemptSchema),
  })
  .strict();
export type BrainPayload = z.infer<typeof brainPayloadSchema>;

export type BrainBundle = { manifest: BrainManifest; payload: BrainPayload };

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function serializeBrainBundle(input: {
  sourceProject: { id: string; name: string };
  createdAt: string;
  redactionFindings: number;
  payload: BrainPayload;
}): string {
  const payloadRaw = JSON.stringify(input.payload);
  const manifest: BrainManifest = brainManifestSchema.parse({
    schemaVersion: BRAIN_SCHEMA_VERSION,
    kind: "megabrain",
    sourceProject: input.sourceProject,
    createdAt: input.createdAt,
    counts: {
      memories: input.payload.memories.length,
      rules: input.payload.rules.length,
      failures: input.payload.failures.length,
    },
    payloadSha256: sha256Hex(payloadRaw),
    redactionFindings: input.redactionFindings,
  });
  return `${JSON.stringify(manifest)}\n${payloadRaw}`;
}

export function parseBrainBundle(text: string): BrainBundle {
  const idx = text.indexOf("\n");
  if (idx === -1) {
    throw new BrainBundleError(
      "malformed",
      "Bundle must contain a manifest line and a payload line.",
    );
  }
  const manifestRaw = text.slice(0, idx);
  const payloadRaw = text.slice(idx + 1);

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch {
    throw new BrainBundleError("malformed", "Bundle manifest is not valid JSON.");
  }
  if (manifestJson === null || typeof manifestJson !== "object") {
    throw new BrainBundleError("malformed", "Bundle manifest is not a JSON object.");
  }
  const version = (manifestJson as { schemaVersion?: unknown }).schemaVersion;
  if (version !== BRAIN_SCHEMA_VERSION) {
    throw new BrainBundleError(
      "unsupported_version",
      `Bundle schemaVersion ${String(version)} is not supported; this build reads version ${BRAIN_SCHEMA_VERSION}. Upgrade mega.`,
    );
  }
  const manifestResult = brainManifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) {
    throw new BrainBundleError("malformed", "Bundle manifest failed schema validation.");
  }
  const manifest = manifestResult.data;

  if (sha256Hex(payloadRaw) !== manifest.payloadSha256) {
    throw new BrainBundleError(
      "hash_mismatch",
      "Bundle payload hash mismatch — file is corrupted or tampered.",
    );
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(payloadRaw);
  } catch {
    throw new BrainBundleError("malformed", "Bundle payload is not valid JSON.");
  }
  const payloadResult = brainPayloadSchema.safeParse(payloadJson);
  if (!payloadResult.success) {
    throw new BrainBundleError("malformed", "Bundle payload failed schema validation.");
  }
  return { manifest, payload: payloadResult.data };
}
