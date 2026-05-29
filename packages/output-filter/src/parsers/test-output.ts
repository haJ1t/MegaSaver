import type { Chunk } from "../rank.js";

const SIGNATURE = /^(?:PASS|FAIL)\s|^\s*[✓✗×]\s|^Tests?:\s.*\b(?:passed|failed|total)\b/m;

export function detectTestOutput(text: string): boolean {
  return SIGNATURE.test(text);
}

export function parseTestOutput(text: string): Chunk[] {
  return text.split("\n").map((line, i) => ({ text: line, startLine: i + 1, endLine: i + 1 }));
}
