import type { OutputCategory } from "../classify.js";
import { compressDiff } from "./diff.js";
import { compressTsc } from "./tsc.js";
import { compressVitest } from "./vitest.js";

export type CompressorName = "vitest" | "typescript" | "diff" | "generic";

// Dispatch the category-specific compressor. generic_shell/unknown (and
// any low-confidence call upstream) pass through unchanged to the
// generic chunk/rank pipeline.
export function compressByCategory(
  category: OutputCategory,
  text: string,
): { text: string; compressor: CompressorName } {
  if (category === "vitest") return { text: compressVitest(text), compressor: "vitest" };
  if (category === "typescript") return { text: compressTsc(text), compressor: "typescript" };
  if (category === "diff") return { text: compressDiff(text), compressor: "diff" };
  return { text, compressor: "generic" };
}
