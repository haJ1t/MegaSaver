import type { Chunk } from "../rank.js";

const RESULT_LINE = /^test result:/m;
const STDOUT_HEADER = /^---- .+ stdout ----$/;
const SUMMARY_LINE = /^(?:failures:|test result:)/;

export function detectCargoTest(text: string): boolean {
  return RESULT_LINE.test(text);
}

export function parseCargoTest(text: string): Chunk[] {
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  let blockStart = 0;
  let inStdout = false;
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
    if (STDOUT_HEADER.test(line)) {
      flush(i);
      inStdout = true;
    } else if (inStdout && SUMMARY_LINE.test(line)) {
      flush(i);
      inStdout = false;
    }
  }
  flush(lines.length);
  return chunks;
}
