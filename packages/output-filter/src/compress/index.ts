import type { OutputCategory } from "../classify.js";
import { compressDiff } from "./diff.js";
import { compressJson } from "./json.js";
import { compressTsc } from "./tsc.js";
import { compressVitest } from "./vitest.js";

export type CompressorName = "vitest" | "typescript" | "diff" | "structured" | "generic";

// Dispatch the category-specific compressor. generic_shell/unknown (and
// any low-confidence call upstream) pass through unchanged to the
// generic chunk/rank pipeline. `intent` is threaded only to the structured
// compressor, which force-keeps intent-matched keys in its schema.
export function compressByCategory(
  category: OutputCategory,
  text: string,
  intent?: string,
): { text: string; compressor: CompressorName } {
  if (category === "vitest") return { text: compressVitest(text), compressor: "vitest" };
  if (category === "typescript") return { text: compressTsc(text), compressor: "typescript" };
  if (category === "diff") return { text: compressDiff(text), compressor: "diff" };
  if (category === "structured")
    return { text: compressJson(text, intent), compressor: "structured" };
  return { text, compressor: "generic" };
}
