import { createHash } from "node:crypto";
import type { ZodType, ZodTypeDef } from "zod";

export type BundleFrameErrorCode = "malformed" | "hash_mismatch" | "unsupported_version";

// Input is `unknown` (not M): entity schemas in payloads use .default()/.transform(),
// so their zod Input type diverges from the Output type.
export interface BundleFrameConfig<M, P> {
  schemaVersion: string;
  manifestSchema: ZodType<M, ZodTypeDef, unknown>;
  payloadSchema: ZodType<P, ZodTypeDef, unknown>;
  payloadShaOf: (manifest: M) => string;
  makeError: (code: BundleFrameErrorCode, message: string) => Error;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function serializeBundle<M, P>(
  cfg: BundleFrameConfig<M, P>,
  bundle: { manifest: M; payload: P },
): string {
  const manifest = cfg.manifestSchema.parse(bundle.manifest);
  return `${JSON.stringify(manifest)}\n${JSON.stringify(bundle.payload)}`;
}

export function parseBundle<M, P>(
  cfg: BundleFrameConfig<M, P>,
  text: string,
): { manifest: M; payload: P } {
  const idx = text.indexOf("\n");
  if (idx === -1) {
    throw cfg.makeError("malformed", "Bundle must contain a manifest line and a payload line.");
  }
  const manifestRaw = text.slice(0, idx);
  // Serialize never appends a trailing newline; strip one a transfer/editor may
  // have added so a benign final newline isn't misread as corruption.
  const payloadRaw = text.slice(idx + 1).replace(/\r?\n$/, "");

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch {
    throw cfg.makeError("malformed", "Bundle manifest is not valid JSON.");
  }
  if (manifestJson === null || typeof manifestJson !== "object") {
    throw cfg.makeError("malformed", "Bundle manifest is not a JSON object.");
  }
  const version = (manifestJson as { schemaVersion?: unknown }).schemaVersion;
  if (version !== cfg.schemaVersion) {
    throw cfg.makeError(
      "unsupported_version",
      `Bundle schemaVersion ${String(version)} is not supported; this build reads version ${cfg.schemaVersion}. Upgrade mega.`,
    );
  }
  const manifestResult = cfg.manifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) {
    throw cfg.makeError("malformed", "Bundle manifest failed schema validation.");
  }
  const manifest = manifestResult.data;

  if (sha256Hex(payloadRaw) !== cfg.payloadShaOf(manifest)) {
    throw cfg.makeError(
      "hash_mismatch",
      "Bundle payload hash mismatch — file is corrupted or tampered.",
    );
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(payloadRaw);
  } catch {
    throw cfg.makeError("malformed", "Bundle payload is not valid JSON.");
  }
  const payloadResult = cfg.payloadSchema.safeParse(payloadJson);
  if (!payloadResult.success) {
    throw cfg.makeError("malformed", "Bundle payload failed schema validation.");
  }
  return { manifest, payload: payloadResult.data };
}
