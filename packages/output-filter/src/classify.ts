import { z } from "zod";
import { normalize } from "./normalize.js";

// Proxy Mode v1.2 §10.4 categories. vitest/typescript get specialized
// compressors (P2); generic_shell/unknown fall back to the generic
// output filter.
export const outputCategorySchema = z.enum([
  "vitest",
  "typescript",
  "diff",
  "structured",
  "prose",
  "generic_shell",
  "unknown",
]);
export type OutputCategory = z.infer<typeof outputCategorySchema>;

export type ClassifyInput = {
  // Command line (command + args joined), when the output came from a
  // run-command call. Used alongside output sniffing (§10.3).
  command?: string | undefined;
  // Source file path, when the output came from a read-file call. A *.json
  // / lockfile path raises confidence for the structured category.
  path?: string | undefined;
  // Source kind — "fetch" for URL-fetched content (e.g. web docs).
  source?: string | undefined;
  text: string;
};

export type Classification = {
  category: OutputCategory;
  confidence: number;
};

// Below this, a classification is treated as generic — specialized
// compressor dispatch (P2) requires a confident vitest/typescript call.
export const CLASSIFICATION_CONFIDENCE_FLOOR = 0.5;

const VITEST_CMD = /\bvitest\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b/i;
const TS_CMD = /\btsc\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:typecheck|type-check)\b/i;
const DIFF_CMD = /\bgit\s+(?:diff|status|log|show)\b/i;

// Sniffers run on ANSI-stripped text (§10.2).
const VITEST_OUT =
  /^\s*Test Files\s|^\s*Tests\s+\d|Serialized Error|AssertionError|^\s*(?:FAIL|PASS)\b|Duration\s+\d/m;
const TS_OUT = /\(\d+,\d+\):\s+error\s+TS\d+:|error\s+TS\d+:|Found\s+\d+\s+errors?/m;
// Out-only sniff requires a real diff anchor: a `diff --git` header or a
// `@@ ... @@` hunk. A lone leading +/- line is NOT a confident diff signal
// — npm/yarn logs, markdown bullets, ASCII tables and console output all
// carry one and must not be routed to the diff compressor. git status/log
// without these anchors is caught by the command path instead.
const DIFF_OUT = /^diff --git |^@@ .* @@/m;

const JSON_PATH = /\.json$|(?:^|\/)pnpm-lock\.yaml$/i;
const JSON_CMD = /\b(?:cat|jq|curl)\b.*\.json\b|\bjq\b/i;
// Above this length a homogeneous array benefits from schematizing. Mirrors
// compressJson's MIN_ARRAY_LEN; small arrays fall through to existing
// behaviour even when path/command hint at JSON.
const STRUCTURED_MIN_ARRAY_LEN = 20;

// Prose / markdown docs sniff. Checked last — must not steal diff/ts/vitest.
// Requires at least one ATX heading as the primary signal; structural markers
// (code fences, bullet/numbered lists) raise confidence. A command reading a
// *.md/.rst/.txt file is an independent high-confidence signal.
const PROSE_CMD = /\b(?:cat|less|bat)\b.*\.(?:md|rst|txt)\b/i;
const PROSE_HEADING = /^#{1,6} /m;
const PROSE_STRUCT = /^```|^[-*+] |\b\d+\. /m;
// Anti-guards: if any fires on the normalized text, prose is disqualified.
// These shadow the earlier category checks but are kept here for locality.
const PROSE_ANTI_DIFF = /^diff --git |^@@ .* @@/m;
const PROSE_ANTI_TS = /\(\d+,\d+\):\s+error\s+TS\d+:|error\s+TS\d+:|Found\s+\d+\s+errors?/m;
const PROSE_ANTI_VI = /^\s*Test Files\s|^\s*Tests\s+\d|AssertionError/m;

// The structured sniff fires ONLY when the body actually parses to a large
// homogeneous array of objects — the only shape compressJson collapses.
// Path/command (*.json, cat/jq) raise confidence but never fire on their own,
// so a small/heterogeneous/non-array JSON file falls through untouched.
function structuredArrayMatch(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length <= STRUCTURED_MIN_ARRAY_LEN) return false;
  const first = parsed[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) return false;
  const keySet = Object.keys(first).join(" ");
  if (keySet === "") return false;
  return parsed.every(
    (el) =>
      typeof el === "object" &&
      el !== null &&
      !Array.isArray(el) &&
      Object.keys(el).join(" ") === keySet,
  );
}

// Typescript is checked before vitest: a TS error signature is highly
// specific, whereas a test command may incidentally compile TS.
export function classifyOutput(input: ClassifyInput): Classification {
  const command = input.command ?? "";
  const path = input.path ?? "";
  const text = normalize(input.text);

  // Diff is checked first: a `diff --git`/`@@` anchor (or a git diff/log/show
  // command) is unambiguous, whereas a diff BODY can legitimately contain
  // `error TS####` text — checking typescript first would misroute such a diff
  // to the typescript compressor and mangle it (obs 5561).
  const diffCmd = DIFF_CMD.test(command);
  const diffOut = DIFF_OUT.test(text);
  if (diffCmd || diffOut) {
    return { category: "diff", confidence: diffCmd && diffOut ? 0.95 : diffCmd ? 0.8 : 0.7 };
  }

  const tsCmd = TS_CMD.test(command);
  const tsOut = TS_OUT.test(text);
  if (tsCmd || tsOut) {
    return { category: "typescript", confidence: tsCmd && tsOut ? 0.95 : tsCmd ? 0.8 : 0.7 };
  }

  const viCmd = VITEST_CMD.test(command);
  const viOut = VITEST_OUT.test(text);
  if (viCmd || viOut) {
    return { category: "vitest", confidence: viCmd && viOut ? 0.95 : viCmd ? 0.8 : 0.7 };
  }

  if (structuredArrayMatch(text)) {
    const hint = JSON_PATH.test(path) || JSON_CMD.test(command);
    return { category: "structured", confidence: hint ? 0.95 : 0.7 };
  }

  // Prose is checked after all other specialized categories so it never
  // steals diff/typescript/vitest/structured. Anti-guards double-check the
  // text even though those categories are checked earlier — defence in depth.
  if (!PROSE_ANTI_DIFF.test(text) && !PROSE_ANTI_TS.test(text) && !PROSE_ANTI_VI.test(text)) {
    const hasHeading = PROSE_HEADING.test(text);
    const hasStruct = PROSE_STRUCT.test(text);
    const proseCmd = PROSE_CMD.test(command);
    const isFetch = (input.source ?? "") === "fetch";

    if (proseCmd) {
      return { category: "prose", confidence: 0.8 };
    }
    if (isFetch && hasHeading) {
      return { category: "prose", confidence: 0.75 };
    }
    if (hasHeading && hasStruct) {
      return { category: "prose", confidence: 0.85 };
    }
    if (hasHeading) {
      return { category: "prose", confidence: 0.7 };
    }
  }

  if (command !== "") {
    return { category: "generic_shell", confidence: 0.6 };
  }
  return { category: "unknown", confidence: 0 };
}

export function isConfidentClassification(c: Classification): boolean {
  return (
    (c.category === "vitest" ||
      c.category === "typescript" ||
      c.category === "diff" ||
      c.category === "structured" ||
      c.category === "prose") &&
    c.confidence >= CLASSIFICATION_CONFIDENCE_FLOOR
  );
}
