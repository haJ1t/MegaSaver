import type { Chunk } from "../rank.js";

const FAILURES_BANNER = /^=+\s*FAILURES\s*=+$/m;
const FAILURE_HEADER = /^_+\s+\S.*\s+_+$/;
const SUMMARY_BANNER = /^=+\s*short test summary info\s*=+$/;

export function detectPytest(text: string): boolean {
  return FAILURES_BANNER.test(text);
}

export function parsePytest(text: string): Chunk[] {
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
    if (FAILURE_HEADER.test(line) || SUMMARY_BANNER.test(line)) flush(i);
  }
  flush(lines.length);
  return chunks;
}
