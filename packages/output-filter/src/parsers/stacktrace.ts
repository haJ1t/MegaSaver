import type { Chunk } from "../rank.js";

// Same bounding as rank.ts's STACKTRACE, and for the same `\s+`/`.+` reason,
// plus one of its own: the two `.+` runs are quadratic on a paren-dense line,
// since every offset that could be the `\(` re-scans the rest — 16.5 s
// unbounded on a 100 KB run of `(`. detectStacktrace runs this against the
// WHOLE normalized document, so one such line is enough. Do not restore `+`.
const SIGNATURE = /^\s{1,64}at\s{1,8}.{1,512}\(.{1,512}:\d+:\d+\)/m;

export function detectStacktrace(text: string): boolean {
  return SIGNATURE.test(text);
}

export function parseStacktrace(text: string): Chunk[] {
  return text.split("\n").map((line, i) => ({ text: line, startLine: i + 1, endLine: i + 1 }));
}
