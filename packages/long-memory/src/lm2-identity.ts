import { createHash } from "node:crypto";
import { Lm2Error } from "./lm2-errors.js";
import type { ModelDescriptor } from "./lm2-model.js";

export type Lm2Sha256 = string & { readonly __lm2Sha256: unique symbol };

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

function sha256(value: string): Lm2Sha256 {
  return createHash("sha256").update(value, "utf8").digest("hex") as Lm2Sha256;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function modelDescriptorFingerprint(model: ModelDescriptor): Lm2Sha256 {
  return sha256(canonicalJson(model));
}

export function embeddingInputDigest(input: {
  kind: "state_snapshot" | "state_transition";
  text: string;
}): Lm2Sha256 {
  if (input.text !== input.text.normalize("NFC").trim() || input.text.length === 0) {
    throw new Lm2Error("invalid_input", "Embedding input must be canonical.");
  }
  return sha256(`megasaver.long-memory.lm2.embedding-input.v1\0${canonicalJson(input)}`);
}

export function canonicalFloat32(values: readonly number[]): Float32Array {
  const vector = Float32Array.from(values);
  let maximum = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Lm2Error("invalid_vectors", "Invalid embedding vector.");
    }
    maximum = Math.max(maximum, Math.abs(value));
  }
  if (maximum === 0) throw new Lm2Error("invalid_vectors", "Invalid embedding vector.");

  let sum = 0;
  for (const value of vector) {
    const scaled = value / maximum;
    sum += scaled * scaled;
  }
  if (!Number.isFinite(sum) || sum === 0) {
    throw new Lm2Error("invalid_vectors", "Invalid embedding vector.");
  }
  return vector;
}
