import type { Chunk } from "../rank.js";

const FAIL_LINE = /^\s*--- FAIL:/m;
const RUN_LINE = /^=== RUN\s/;

export function detectGoTest(text: string): boolean {
  return FAIL_LINE.test(text);
}

export function parseGoTest(text: string): Chunk[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (RUN_LINE.test(lines[i] ?? "")) starts.push(i);
  }

  const chunks: Chunk[] = [];
  for (let b = 0; b < starts.length; b += 1) {
    const start = starts[b] ?? 0;
    const end = starts[b + 1] ?? lines.length;
    const block = lines.slice(start, end);
    if (!FAIL_LINE.test(block.join("\n"))) continue;
    chunks.push({ text: block.join("\n"), startLine: start + 1, endLine: end });
  }
  return chunks;
}
