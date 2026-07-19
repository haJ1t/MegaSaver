import { z } from "zod";
import { type BundleFrameConfig, parseBundle, serializeBundle, sha256Hex } from "./bundle-frame.js";
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

const brainFrame: BundleFrameConfig<BrainManifest, BrainPayload> = {
  schemaVersion: BRAIN_SCHEMA_VERSION,
  manifestSchema: brainManifestSchema,
  payloadSchema: brainPayloadSchema,
  payloadShaOf: (manifest) => manifest.payloadSha256,
  makeError: (code, message) => new BrainBundleError(code, message),
};

export function serializeBrainBundle(input: {
  sourceProject: { id: string; name: string };
  createdAt: string;
  redactionFindings: number;
  payload: BrainPayload;
}): string {
  const payloadRaw = JSON.stringify(input.payload);
  const manifest: BrainManifest = {
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
  };
  return serializeBundle(brainFrame, { manifest, payload: input.payload });
}

export function parseBrainBundle(text: string): BrainBundle {
  return parseBundle(brainFrame, text);
}
