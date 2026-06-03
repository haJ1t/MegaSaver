import type { Chunk } from "../rank.js";

const SUMMARY = /^\s*✖ \d+ problems?/m;
const PROBLEM_ROW = /^\s+\d+:\d+\s+(?:error|warning)\s/m;
const FILE_HEADER = /^\S/;

export function detectEslint(text: string): boolean {
  return SUMMARY.test(text) && PROBLEM_ROW.test(text);
}

export function parseEslint(text: string): Chunk[] {
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  let blockStart = 0;
  const flush = (end: number): void => {
    if (end <= blockStart) return;
    chunks.push({
      text: lines.slice(blockStart, end).join("\n"),
      startLine: blockStart + 1,
      endLine: end,
    });
    blockStart = end;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    // The summary starts with a non-space glyph too, so test it first.
    if (SUMMARY.test(line) || FILE_HEADER.test(line)) flush(i);
  }
  flush(lines.length);
  return chunks;
}
