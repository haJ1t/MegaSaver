import type { Chunk } from "../rank.js";

// Both leading runs are bounded for the same reason as classify.ts's vitest
// patterns: `^` under `m` anchors after every U+2028/U+2029 and `\s` matches
// them, so an unbounded run rescans the whole remaining separator run from each
// anchor. normalize splits on `\n` only, so such a run reaches here intact.
// Reverted one at a time, each costs ~30 s on 200 KB (29.9 s SUMMARY, 30.0 s
// PROBLEM_ROW) — SUMMARY runs first and short-circuits the `&&` below, so
// PROBLEM_ROW is only reachable behind a real summary line.
// Bounding the leading run is also what defuses PROBLEM_ROW's second `\s+`: a
// start position must now be within 64 chars of the `\d+:\d+`, so only O(64)
// starts can reach any one gap. eslint indents problem rows by two spaces. Do
// not restore `*`/`+`.
const SUMMARY = /^\s{0,64}✖ \d+ problems?/m;
const PROBLEM_ROW = /^\s{1,64}\d+:\d+\s+(?:error|warning)\s/m;
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
