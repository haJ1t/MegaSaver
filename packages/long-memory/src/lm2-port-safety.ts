export type Lm2PortSnapshot = { status: "readable"; value: unknown } | { status: "unreadable" };

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

function snapshotValue(value: unknown, ancestors: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object") throw new Error("unsupported port value");
  if (ancestors.has(value)) throw new Error("cyclic port value");
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) throw new Error("symbol port key");
    if (Array.isArray(value)) {
      const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        throw new Error("invalid port array length");
      }
      const length = lengthDescriptor.value;
      const stringKeys = keys.filter((key): key is string => typeof key === "string");
      if (
        stringKeys.length !== length + 1 ||
        stringKeys.some((key) => key !== "length" && !ARRAY_INDEX.test(key))
      ) {
        throw new Error("non-canonical port array key");
      }
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw new Error("unreadable port array item");
        }
        result.push(snapshotValue(descriptor.value, ancestors));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") throw new Error("symbol port key");
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("unreadable port field");
      }
      result[key] = snapshotValue(descriptor.value, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function snapshotLm2PortValue(value: unknown): Lm2PortSnapshot {
  try {
    return { status: "readable", value: snapshotValue(value, new Set()) };
  } catch {
    return { status: "unreadable" };
  }
}
