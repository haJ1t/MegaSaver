import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { Lm2Error } from "./lm2-errors.js";
import {
  canonicalFloat32,
  embeddingInputDigest,
  modelDescriptorFingerprint,
} from "./lm2-identity.js";
import {
  type Lm2Candidate,
  type ModelDescriptor,
  lm2CandidateSchema,
  modelDescriptorSchema,
} from "./lm2-model.js";

export const MAX_LM2_SIDECAR_BYTES = 24 * 1024;
export const MAX_LM2_WORKSPACE_VECTOR_BYTES = 128 * 1024 * 1024;
export const MAX_LM2_VECTOR_NAMESPACES = 2;
export const MAX_LM2_SIDECARS_PER_NAMESPACE = 10_000;
export const MAX_LM2_DECODED_QUERY_VECTOR_BYTES = 64 * 1024 * 1024;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
const sidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceKey: workspaceKeySchema,
    recordId: lowercaseUuidSchema,
    kind: z.enum(["state_snapshot", "state_transition"]),
    sourceDigest: sha256Schema,
    embeddingInputDigest: sha256Schema,
    model: modelDescriptorSchema,
    dimension: z.number().int().min(1).max(4_096),
    vectorBase64: z.string().min(1).max(32_768),
  })
  .strict();
export type VectorSidecar = z.infer<typeof sidecarSchema>;

export type SidecarMetadata = {
  sidecar: VectorSidecar;
  serializedBytes: number;
};

export function parseModel(model: ModelDescriptor): ModelDescriptor {
  const parsed = modelDescriptorSchema.safeParse(model);
  if (!parsed.success) throw new Lm2Error("invalid_input", "Invalid model descriptor.");
  return parsed.data;
}

export function parseCandidates(
  workspaceKey: string,
  candidates: readonly Lm2Candidate[],
  maximum: number,
): Lm2Candidate[] {
  const parsedWorkspace = workspaceKeySchema.safeParse(workspaceKey);
  if (!parsedWorkspace.success || candidates.length > maximum) {
    throw new Lm2Error("invalid_input", "Invalid LM2 vector request.");
  }
  const parsed: Lm2Candidate[] = [];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    const result = lm2CandidateSchema.safeParse(candidate);
    if (
      !result.success ||
      result.data.workspaceKey !== parsedWorkspace.data ||
      ids.has(result.data.id)
    ) {
      throw new Lm2Error("invalid_input", "Invalid LM2 vector request.");
    }
    try {
      embeddingInputDigest({ kind: result.data.kind, text: result.data.text });
    } catch {
      throw new Lm2Error("invalid_input", "Invalid LM2 vector request.");
    }
    ids.add(result.data.id);
    parsed.push(result.data);
  }
  return parsed;
}

export function canonicalEmbeddingInput(candidate: Lm2Candidate): string {
  return `megasaver.long-memory.lm2.embedding-input.v1\0${JSON.stringify({
    kind: candidate.kind,
    text: candidate.text,
  })}`;
}

function isCanonicalBase64(value: string, decodedBytes: number): boolean {
  const expectedLength = Math.ceil(decodedBytes / 3) * 4;
  const padding = (3 - (decodedBytes % 3)) % 3;
  if (value.length !== expectedLength || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  if (padding > 0 && !value.endsWith("=".repeat(padding))) return false;
  if (padding === 0 && value.endsWith("=")) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lastDataIndex = alphabet.indexOf(value[value.length - padding - 1] ?? "");
  if (lastDataIndex < 0) return false;
  return padding === 2 ? (lastDataIndex & 15) === 0 : padding !== 1 || (lastDataIndex & 3) === 0;
}

function serializeSidecar(sidecar: VectorSidecar): string {
  return `${JSON.stringify(sidecar)}\n`;
}

export function parseSidecarMetadata(
  raw: Buffer,
  expectedFingerprint: string,
): SidecarMetadata | null {
  if (raw.byteLength === 0 || raw.byteLength > MAX_LM2_SIDECAR_BYTES) return null;
  const text = raw.toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = sidecarSchema.safeParse(value);
  if (!parsed.success || serializeSidecar(parsed.data) !== text) return null;
  if (
    parsed.data.dimension !== parsed.data.model.dimensions ||
    modelDescriptorFingerprint(parsed.data.model) !== expectedFingerprint ||
    !isCanonicalBase64(parsed.data.vectorBase64, parsed.data.dimension * 4)
  ) {
    return null;
  }
  return { sidecar: parsed.data, serializedBytes: raw.byteLength };
}

export function matchesCandidate(
  metadata: SidecarMetadata,
  workspaceKey: string,
  model: ModelDescriptor,
  candidate: Lm2Candidate,
): boolean {
  const { sidecar } = metadata;
  return (
    sidecar.workspaceKey === workspaceKey &&
    sidecar.recordId === candidate.id &&
    sidecar.kind === candidate.kind &&
    sidecar.sourceDigest === candidate.sourceDigest &&
    sidecar.embeddingInputDigest ===
      embeddingInputDigest({ kind: candidate.kind, text: candidate.text }) &&
    JSON.stringify(sidecar.model) === JSON.stringify(model)
  );
}

export function decodeSidecarVector(metadata: SidecarMetadata): Float32Array | null {
  const { dimension, vectorBase64 } = metadata.sidecar;
  const bytes = Buffer.from(vectorBase64, "base64");
  if (bytes.byteLength !== dimension * 4 || bytes.toString("base64") !== vectorBase64) return null;
  const values = Array.from({ length: dimension }, (_, index) => bytes.readFloatLE(index * 4));
  try {
    return canonicalFloat32(values);
  } catch {
    return null;
  }
}

function encodeVector(vector: Float32Array): string {
  const bytes = Buffer.alloc(vector.byteLength);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes.toString("base64");
}

export function buildSerializedSidecar(
  model: ModelDescriptor,
  candidate: Lm2Candidate,
  values: readonly unknown[],
): string {
  if (
    values.length !== model.dimensions ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Lm2Error("invalid_vectors", "Invalid embedding vector tuple.");
  }
  const vector = canonicalFloat32(values as readonly number[]);
  const serialized = serializeSidecar({
    schemaVersion: 1,
    workspaceKey: candidate.workspaceKey,
    recordId: candidate.id,
    kind: candidate.kind,
    sourceDigest: candidate.sourceDigest,
    embeddingInputDigest: embeddingInputDigest({ kind: candidate.kind, text: candidate.text }),
    model,
    dimension: model.dimensions,
    vectorBase64: encodeVector(vector),
  });
  if (Buffer.byteLength(serialized, "utf8") > MAX_LM2_SIDECAR_BYTES) {
    throw new Lm2Error("write_failed", "LM2 vector sidecar exceeds its storage limit.");
  }
  return serialized;
}
