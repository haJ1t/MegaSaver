import { createHash } from "node:crypto";
import type { Lm1Kind, PreparedCapture } from "./lm1-model.js";

export type Sha256 = string & { readonly __sha256: unique symbol };

type CanonicalCapture =
  | Omit<Extract<PreparedCapture, { kind: "state_snapshot" }>, "canonicalCaptureDigest">
  | Omit<Extract<PreparedCapture, { kind: "state_transition" }>, "canonicalCaptureDigest">;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function sha256(value: string): Sha256 {
  return createHash("sha256").update(value, "utf8").digest("hex") as Sha256;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalCaptureDigest(input: CanonicalCapture | PreparedCapture): Sha256 {
  const capture =
    input.kind === "state_snapshot"
      ? {
          schemaVersion: input.schemaVersion,
          workspaceKey: input.workspaceKey,
          kind: input.kind,
          observedAt: input.observedAt,
          text: input.text,
          action: input.action,
          evidenceIds: input.evidenceIds,
          stateKey: input.stateKey,
          representation: input.representation,
          supersedesSnapshotId: input.supersedesSnapshotId,
          redactionVersion: input.redactionVersion,
        }
      : {
          schemaVersion: input.schemaVersion,
          workspaceKey: input.workspaceKey,
          kind: input.kind,
          observedAt: input.observedAt,
          text: input.text,
          action: input.action,
          evidenceIds: input.evidenceIds,
          preSnapshotId: input.preSnapshotId,
          postSnapshotId: input.postSnapshotId,
          outcome: input.outcome,
          redactionVersion: input.redactionVersion,
        };
  return sha256(`megasaver.long-memory.lm1.capture.v1\0${canonicalJson(capture)}`);
}

export function deriveLm1RecordId(
  workspaceKey: string,
  kind: Lm1Kind,
  sourceDigest: string,
): string {
  const bytes = createHash("sha256")
    .update(`megasaver.long-memory.lm1.id.v1\0${workspaceKey}\0${kind}\0${sourceDigest}`, "utf8")
    .digest()
    .subarray(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("SHA-256 digest is unexpectedly short.");
  }
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deriveEvidenceBindingDigest(input: {
  workspaceKey: string;
  canonicalCaptureDigest: string;
  evidenceIds: readonly string[];
  evidenceDigests: readonly string[];
}): Sha256 {
  return sha256(`megasaver.long-memory.lm1.binding.v1\0${canonicalJson(input)}`);
}
