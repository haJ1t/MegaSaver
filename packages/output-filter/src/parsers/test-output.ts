import type { Chunk } from "../rank.js";

// The `^\s*[✓✗×]` alternative is bounded for the same reason as classify.ts's
// vitest patterns: `^` under `m` anchors after every U+2028/U+2029 and `\s`
// matches them, so an unbounded run rescans the whole remaining separator run
// from each anchor — 30.7 s on 200 KB. normalize splits on `\n` only, so such a
// run reaches here intact. Reporter indents are a handful of spaces. Do not
// restore `*`.
const SIGNATURE = /^(?:PASS|FAIL)\s|^\s{0,64}[✓✗×]\s|^Tests?:\s.*\b(?:passed|failed|total)\b/m;

export function detectTestOutput(text: string): boolean {
  return SIGNATURE.test(text);
}

export function parseTestOutput(text: string): Chunk[] {
  return text.split("\n").map((line, i) => ({ text: line, startLine: i + 1, endLine: i + 1 }));
}
