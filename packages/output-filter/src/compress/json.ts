// Structured-data schematizer. Only the array-collapse path ships: a large
// homogeneous array of objects becomes its inferred schema + a few verbatim
// sample rows + a counted marker for the dropped middle. Everything else
// (small/heterogeneous/non-array/malformed) returns unchanged. Lossless: the
// raw JSON is still persisted to the ChunkSet and recoverable via
// mega_fetch_chunk — this only changes what is RETURNED.

import { tokenizeForMatch } from "../tokenize.js";

const MIN_ARRAY_LEN = 20;
const SAMPLE_FROM_FIRST = 3;
const SCHEMA_SAMPLE_DEPTH = 10;

function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Homogeneous = every element is a plain object whose key set matches the
// first element's exactly. A single mismatched element disqualifies the
// whole array (evidence preservation: don't pretend a ragged array is a
// uniform table).
function homogeneousKeys(arr: readonly unknown[]): string[] | null {
  const first = arr[0];
  if (!isPlainObject(first)) return null;
  const keys = Object.keys(first);
  if (keys.length === 0) return null;
  const keySet = keys.join("\u0000");
  for (const el of arr) {
    if (!isPlainObject(el)) return null;
    if (Object.keys(el).join("\u0000") !== keySet) return null;
  }
  return keys;
}

export function compressJson(text: string, intent: string | undefined): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  if (!Array.isArray(parsed) || parsed.length <= MIN_ARRAY_LEN) return text;

  const keys = homogeneousKeys(parsed);
  if (keys === null) return text;

  const intentTokens = new Set(intent === undefined ? [] : tokenizeForMatch(intent));
  const intentKeys = keys.filter((k) => tokenizeForMatch(k).some((t) => intentTokens.has(t)));

  const typesFromSample = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]));
  for (const el of parsed.slice(0, SCHEMA_SAMPLE_DEPTH) as Record<string, unknown>[]) {
    for (const k of keys) typesFromSample.get(k)?.add(valueType(el[k]));
  }

  const schemaLines = keys.map((k) => {
    const types = [...(typesFromSample.get(k) ?? [])].join("|");
    const kept = intentKeys.includes(k) ? " (kept: intent)" : "";
    return `  ${k}: ${types}${kept}`;
  });

  const head = (parsed.slice(0, SAMPLE_FROM_FIRST) as unknown[]).map((e) =>
    JSON.stringify(e, null, 2),
  );
  const tail = JSON.stringify(parsed[parsed.length - 1], null, 2);
  const dropped = parsed.length - SAMPLE_FROM_FIRST - 1;

  return [
    `Array<{ ${keys.length} keys }> · ${parsed.length} elements`,
    "schema:",
    ...schemaLines,
    "first 3:",
    ...head,
    `… [${dropped} more of same shape]`,
    "last:",
    tail,
  ].join("\n");
}
