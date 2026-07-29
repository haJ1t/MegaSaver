// Structured-data schematizer. Only the array-collapse path ships: a large
// homogeneous array of objects becomes its inferred schema + a few verbatim
// sample rows + a counted marker for the dropped middle. Everything else
// (small/heterogeneous/non-array/malformed) returns unchanged. Only changes
// what is RETURNED; recovery reality per entry point: the hook path persists
// the full redacted raw, read/exec paths persist kept excerpts only until W2
// unifies them. Intent-matched keys with all-scalar values have those values
// preserved explicitly; the schema annotation never claims otherwise.

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

  // Intent-matched keys: the old "(kept: intent)" annotation lied — values
  // were not preserved. Now they are, but only when every value is scalar
  // (one compact line per key); non-scalar values get an honest annotation.
  const scalarIntentKeys: string[] = [];
  const valueLines: string[] = [];
  for (const k of intentKeys) {
    const values = (parsed as Record<string, unknown>[]).map((el) => el[k]);
    const allScalar = values.every(
      (v) => v === null || ["string", "number", "boolean"].includes(typeof v),
    );
    if (allScalar) {
      scalarIntentKeys.push(k);
      valueLines.push(
        `values of intent-matched key ${JSON.stringify(k)} (${values.length}): ${JSON.stringify(values)}`,
      );
    }
  }

  const schemaLines = keys.map((k) => {
    const types = [...(typesFromSample.get(k) ?? [])].join("|");
    let note = "";
    if (scalarIntentKeys.includes(k)) {
      note = " (intent: values below)";
    } else if (intentKeys.includes(k)) {
      note = " (intent: non-scalar values not preserved — recoverable via stored chunks)";
    }
    return `  ${k}: ${types}${note}`;
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
    ...valueLines,
    "first 3:",
    ...head,
    `… [${dropped} more of same shape — recoverable via stored chunks]`,
    "last:",
    tail,
  ].join("\n");
}
