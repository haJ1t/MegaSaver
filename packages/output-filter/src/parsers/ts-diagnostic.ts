import type { Chunk } from "../rank.js";

const SIGNATURE = /\(\d+,\d+\):\s+error\s+TS\d+:/m;

export function detectTsDiagnostic(text: string): boolean {
  return SIGNATURE.test(text);
}

export function parseTsDiagnostic(text: string): Chunk[] {
  return text.split("\n").map((line, i) => ({ text: line, startLine: i + 1, endLine: i + 1 }));
}
