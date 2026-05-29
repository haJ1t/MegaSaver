import type { Chunk } from "../rank.js";

const SIGNATURE = /^\s+at\s+.+\(.+:\d+:\d+\)/m;

export function detectStacktrace(text: string): boolean {
  return SIGNATURE.test(text);
}

export function parseStacktrace(text: string): Chunk[] {
  return text.split("\n").map((line, i) => ({ text: line, startLine: i + 1, endLine: i + 1 }));
}
