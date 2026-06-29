import { z } from "zod";
import { normalize } from "./normalize.js";

// Proxy Mode v1.2 §10.4 categories. vitest/typescript get specialized
// compressors (P2); generic_shell/unknown fall back to the generic
// output filter.
export const outputCategorySchema = z.enum([
  "vitest",
  "typescript",
  "diff",
  "generic_shell",
  "unknown",
]);
export type OutputCategory = z.infer<typeof outputCategorySchema>;

export type ClassifyInput = {
  // Command line (command + args joined), when the output came from a
  // run-command call. Used alongside output sniffing (§10.3).
  command?: string | undefined;
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

// Typescript is checked before vitest: a TS error signature is highly
// specific, whereas a test command may incidentally compile TS.
export function classifyOutput(input: ClassifyInput): Classification {
  const command = input.command ?? "";
  const text = normalize(input.text);

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

  const diffCmd = DIFF_CMD.test(command);
  const diffOut = DIFF_OUT.test(text);
  if (diffCmd || diffOut) {
    return { category: "diff", confidence: diffCmd && diffOut ? 0.95 : diffCmd ? 0.8 : 0.7 };
  }

  if (command !== "") {
    return { category: "generic_shell", confidence: 0.6 };
  }
  return { category: "unknown", confidence: 0 };
}

export function isConfidentClassification(c: Classification): boolean {
  return (
    (c.category === "vitest" || c.category === "typescript" || c.category === "diff") &&
    c.confidence >= CLASSIFICATION_CONFIDENCE_FLOOR
  );
}
