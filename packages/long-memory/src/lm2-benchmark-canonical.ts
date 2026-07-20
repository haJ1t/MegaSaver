import { createHash } from "node:crypto";

const PROJECTION_NAMESPACE = "7d20f05d-6a18-52b8-98e0-8f6c933b3484";

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) as number);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON numbers must be finite.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Value is not JSON-compatible.");
  if (ancestors.has(value)) throw new TypeError("Canonical JSON cannot contain cycles.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) {
        throw new TypeError("Canonical JSON arrays must be dense.");
      }
      return `[${value.map((item) => canonicalValue(item, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON objects must be plain.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Canonical JSON keys must be strings.");
    }
    const normalized = keys.map((key) => (key as string).normalize("NFC"));
    if (new Set(normalized).size !== normalized.length) {
      throw new TypeError("Canonical JSON keys collide after normalization.");
    }
    const entries = keys.map((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Canonical JSON properties must be enumerable data properties.");
      }
      return { key: normalized[index] as string, value: descriptor.value as unknown };
    });
    entries.sort((left, right) => compareCodePoints(left.key, right.key));
    return `{${entries
      .map(({ key, value: entry }) => `${JSON.stringify(key)}:${canonicalValue(entry, ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set());
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function uuidBytes(value: string): Buffer {
  const hex = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/u.test(hex)) throw new TypeError("Invalid UUID namespace.");
  return Buffer.from(hex, "hex");
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deriveBenchmarkProjectionId(
  trajectoryId: string,
  sourceKind: string,
  sourceIndex: number,
): string {
  const name = `${trajectoryId}\0${sourceKind}\0${sourceIndex}`;
  const bytes = createHash("sha1")
    .update(uuidBytes(PROJECTION_NAMESPACE))
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function truncateUtf16(value: string, maxCodeUnits: number): string {
  if (value.length <= maxCodeUnits) return value;
  let end = maxCodeUnits;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return value.slice(0, end);
}
