import { type Chunk, chunkByLines, chunkBySemantic } from "@megasaver/output-filter";
import type { LineRange } from "./git.js";

export function overlaps(
  chunk: { startLine: number; endLine: number },
  ranges: readonly LineRange[],
): boolean {
  return ranges.some((r) => chunk.startLine <= r.end && chunk.endLine >= r.start);
}

export async function semanticDiffChunks(input: {
  path: string;
  headText: string;
  ranges: readonly LineRange[];
}): Promise<Chunk[]> {
  const chunks =
    (await chunkBySemantic(input.headText, input.path)) ??
    chunkByLines(input.headText, 40);
  return chunks.filter((c) => overlaps(c, input.ranges));
}
