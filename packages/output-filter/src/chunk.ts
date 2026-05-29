import type { Chunk } from "./rank.js";

export function chunkByLines(text: string, linesPerChunk: number): Chunk[] {
  if (text === "") return [];
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  for (let start = 0; start < lines.length; start += linesPerChunk) {
    const slice = lines.slice(start, start + linesPerChunk);
    chunks.push({
      text: slice.join("\n"),
      startLine: start + 1,
      endLine: start + slice.length,
    });
  }
  return chunks;
}
