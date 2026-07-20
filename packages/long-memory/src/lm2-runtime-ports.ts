import type { EmbeddingPort, RemoteEmbeddingApprovalPort } from "./lm2-model.js";

type Readable<T> = { status: "readable"; value: T } | { status: "unreadable" };
export type Lm2RuntimeCapability =
  | { status: "available"; embedding: EmbeddingPort; approval?: RemoteEmbeddingApprovalPort }
  | {
      status: "unavailable";
      reason:
        | "embedding_port_unreadable"
        | "embedding_egress_mismatch"
        | "approval_port_unreadable";
    };
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

function snapshot(value: unknown, ancestors: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "function"
  ) {
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("unreadable port");
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) throw new Error("unreadable port");
    if (Array.isArray(value)) {
      const length = Reflect.getOwnPropertyDescriptor(value, "length");
      if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value)) {
        throw new Error("unreadable port");
      }
      const stringKeys = keys.filter((key): key is string => typeof key === "string");
      if (
        stringKeys.length !== length.value + 1 ||
        stringKeys.some((key) => key !== "length" && !ARRAY_INDEX.test(key))
      ) {
        throw new Error("unreadable port");
      }
      return Array.from({ length: length.value }, (_, index) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw new Error("unreadable port");
        }
        return snapshot(descriptor.value, ancestors);
      });
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") throw new Error("unreadable port");
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("unreadable port");
      }
      result[key] = snapshot(descriptor.value, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function snapshotObject(value: unknown): Record<string, unknown> | null {
  try {
    const copied = snapshot(value, new Set());
    return copied !== null && typeof copied === "object" && !Array.isArray(copied)
      ? (copied as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readEmbeddingPort(value: unknown): Readable<EmbeddingPort> {
  const port = snapshotObject(value);
  const candidate = port as { egress?: unknown; embed?: unknown } | null;
  if (
    candidate === null ||
    Reflect.ownKeys(candidate).sort().join("\0") !== "egress\0embed" ||
    (candidate.egress !== "local" && candidate.egress !== "remote") ||
    typeof candidate.embed !== "function"
  ) {
    return { status: "unreadable" };
  }
  return { status: "readable", value: candidate as EmbeddingPort };
}

export function readApprovalPort(value: unknown): Readable<RemoteEmbeddingApprovalPort> {
  const port = snapshotObject(value);
  const candidate = port as { assertCurrent?: unknown } | null;
  if (
    candidate === null ||
    Reflect.ownKeys(candidate).join("") !== "assertCurrent" ||
    typeof candidate.assertCurrent !== "function"
  ) {
    return { status: "unreadable" };
  }
  return { status: "readable", value: candidate as RemoteEmbeddingApprovalPort };
}
