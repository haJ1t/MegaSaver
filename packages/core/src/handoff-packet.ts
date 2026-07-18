import { z } from "zod";
import { type BundleFrameConfig, parseBundle, serializeBundle, sha256Hex } from "./bundle-frame.js";
import { failedAttemptSchema } from "./failed-attempt.js";
import { memoryEntrySchema } from "./memory-entry.js";

export const HANDOFF_SCHEMA_VERSION = "1";

export type HandoffPacketErrorCode =
  | "malformed"
  | "hash_mismatch"
  | "unsupported_version"
  | "expired";

export class HandoffPacketError extends Error {
  readonly code: HandoffPacketErrorCode;

  constructor(code: HandoffPacketErrorCode, message: string) {
    super(message);
    this.name = "HandoffPacketError";
    this.code = code;
  }
}

// payloadSha256 protects ONLY the payload line; manifest fields themselves are
// not integrity-protected — counts, expiry, and agents are sender-asserted.
export const handoffManifestSchema = z
  .object({
    schemaVersion: z.literal(HANDOFF_SCHEMA_VERSION),
    kind: z.literal("megahandoff"),
    sourceProject: z.object({ name: z.string().trim().min(1) }).strict(),
    sourceAgent: z.string().min(1),
    targetAgent: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    redactionFindings: z.number().int().nonnegative(),
    secretPathsExcluded: z.number().int().nonnegative(),
    counts: z
      .object({
        memories: z.number().int().nonnegative(),
        failures: z.number().int().nonnegative(),
        diffFiles: z.number().int().nonnegative(),
        commits: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type HandoffManifest = z.infer<typeof handoffManifestSchema>;

export const handoffGitSchema = z
  .object({
    branch: z.string().nullable(),
    headSha: z.string().nullable(),
    dirty: z.boolean(),
    commits: z.array(z.object({ sha: z.string(), subject: z.string(), date: z.string() }).strict()),
    changedFiles: z.array(
      z.object({ path: z.string(), churn: z.number().int().nonnegative() }).strict(),
    ),
    diff: z
      .object({
        text: z.string(),
        truncated: z.boolean(),
        excludedPaths: z.array(z.string()),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type HandoffGit = z.infer<typeof handoffGitSchema>;

export const handoffPayloadSchema = z
  .object({
    taskSummary: z
      .object({ text: z.string(), tokenEstimate: z.number().int().nonnegative() })
      .strict(),
    resumeInstructions: z.string(),
    git: handoffGitSchema.nullable(),
    failures: z.array(failedAttemptSchema),
    memories: z.array(memoryEntrySchema),
  })
  .strict();
export type HandoffPayload = z.infer<typeof handoffPayloadSchema>;

export type HandoffPacket = { manifest: HandoffManifest; payload: HandoffPayload };

const handoffFrame: BundleFrameConfig<HandoffManifest, HandoffPayload> = {
  schemaVersion: HANDOFF_SCHEMA_VERSION,
  manifestSchema: handoffManifestSchema,
  payloadSchema: handoffPayloadSchema,
  payloadShaOf: (manifest) => manifest.payloadSha256,
  makeError: (code, message) => new HandoffPacketError(code, message),
};

export function serializeHandoffPacket(packet: HandoffPacket): string {
  // The sha is derived, never caller-owned: recompute it so a stale manifest
  // hash can never produce a packet that fails its own parse.
  const manifest: HandoffManifest = {
    ...packet.manifest,
    payloadSha256: sha256Hex(JSON.stringify(packet.payload)),
  };
  return serializeBundle(handoffFrame, { manifest, payload: packet.payload });
}

export function parseHandoffPacket(text: string, opts: { now: number }): HandoffPacket {
  const parsed = parseBundle(handoffFrame, text);
  // Inverted comparison so an unparseable expiresAt (Date.parse → NaN, which zod
  // datetime() can let through) fails CLOSED as expired instead of never expiring.
  if (!(Date.parse(parsed.manifest.expiresAt) > opts.now)) {
    throw new HandoffPacketError(
      "expired",
      `Packet expired at ${parsed.manifest.expiresAt} — ask the sender to re-pack, or run mega handoff clear.`,
    );
  }
  return parsed;
}

export interface HandoffDiagnostics {
  version: "ok" | "unsupported";
  manifest: "ok" | "malformed";
  hash: "ok" | "mismatch" | "skipped";
  expiry: "ok" | "expired" | "skipped";
  payloadSchema: "ok" | "malformed" | "skipped";
  // Untrusted whenever hash !== "ok": diagnose surfaces whatever it could parse
  // for display, so consumers must only render these fields, never apply them.
  parsedManifest?: HandoffManifest;
  parsedPayload?: HandoffPayload;
}

export function diagnoseHandoffPacket(text: string, opts: { now: number }): HandoffDiagnostics {
  const diagnostics: HandoffDiagnostics = {
    version: "unsupported",
    manifest: "malformed",
    hash: "skipped",
    expiry: "skipped",
    payloadSchema: "skipped",
  };
  const idx = text.indexOf("\n");
  if (idx === -1) return diagnostics;

  let manifestJson: unknown = null;
  try {
    manifestJson = JSON.parse(text.slice(0, idx));
  } catch {
    manifestJson = null;
  }
  const payloadRaw = text.slice(idx + 1).replace(/\r?\n$/, "");

  if (manifestJson !== null && typeof manifestJson === "object") {
    const version = (manifestJson as { schemaVersion?: unknown }).schemaVersion;
    if (version === HANDOFF_SCHEMA_VERSION) diagnostics.version = "ok";
    const manifestResult = handoffManifestSchema.safeParse(manifestJson);
    if (manifestResult.success) {
      diagnostics.manifest = "ok";
      diagnostics.parsedManifest = manifestResult.data;
      diagnostics.hash =
        sha256Hex(payloadRaw) === manifestResult.data.payloadSha256 ? "ok" : "mismatch";
      // Same fail-closed inversion as parseHandoffPacket: NaN expiresAt → "expired".
      diagnostics.expiry = Date.parse(manifestResult.data.expiresAt) > opts.now ? "ok" : "expired";
    }
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(payloadRaw);
  } catch {
    diagnostics.payloadSchema = "malformed";
    return diagnostics;
  }
  const payloadResult = handoffPayloadSchema.safeParse(payloadJson);
  if (payloadResult.success) {
    diagnostics.payloadSchema = "ok";
    diagnostics.parsedPayload = payloadResult.data;
  } else {
    diagnostics.payloadSchema = "malformed";
  }
  return diagnostics;
}
