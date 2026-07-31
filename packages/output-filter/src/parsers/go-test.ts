import type { Chunk } from "../rank.js";

// Bounded for the same reason as classify.ts's vitest patterns: `^` under `m`
// anchors after every U+2028/U+2029 and `\s` matches them, so an unbounded run
// rescans the whole remaining separator run from each anchor — 30.5 s on 200 KB.
// normalize splits on `\n` only, so such a run reaches here intact. Go's own
// indent is two spaces per subtest level. Do not restore `*`.
const FAIL_LINE = /^\s{0,64}--- FAIL:/m;
// A panicking test never prints `--- FAIL:` — without this its panic message
// and goroutine stack were dropped whenever any other block survived (B8).
const PANIC_LINE = /^\s{0,64}panic:/m;
const RUN_LINE = /^=== RUN\s/;

export function detectGoTest(text: string): boolean {
  return FAIL_LINE.test(text) || PANIC_LINE.test(text);
}

export type GoTestParse = {
  chunks: Chunk[];
  // Omitted segments (passing blocks + one preamble segment) — counted into
  // filterOutput's dropped count so parser-level removal is never invisible.
  dropped: number;
};

export function parseGoTest(text: string): GoTestParse {
  const lines = text.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (RUN_LINE.test(lines[i] ?? "")) starts.push(i);
  }

  const chunks: Chunk[] = [];
  let passingBlocks = 0;
  let omittedStart = Number.POSITIVE_INFINITY;
  let omittedEnd = 0;
  for (let b = 0; b < starts.length; b += 1) {
    const start = starts[b] ?? 0;
    const end = starts[b + 1] ?? lines.length;
    const block = lines.slice(start, end);
    const text = block.join("\n");
    if (!FAIL_LINE.test(text) && !PANIC_LINE.test(text)) {
      passingBlocks += 1;
      if (start < omittedStart) omittedStart = start;
      if (end > omittedEnd) omittedEnd = end;
      continue;
    }
    chunks.push({ text, startLine: start + 1, endLine: end });
  }

  const firstRun = starts[0];
  const preambleLines =
    firstRun === undefined
      ? 0
      : lines.slice(0, firstRun).filter((line) => line.trim() !== "").length;
  if (preambleLines > 0 && firstRun !== undefined) {
    omittedStart = 0;
    omittedEnd = Math.max(omittedEnd, firstRun);
  }

  // SC3-5 (W4): keeping only failing blocks removed the passing blocks and
  // the pre-RUN preamble with no record anywhere — a counted marker line is
  // the record, and the fit reservation keeps it non-droppable. Only emitted
  // alongside kept blocks: with zero kept chunks filterOutput's no-blind
  // fallback re-chunks the whole output, so nothing was omitted after all.
  const named: string[] = [];
  if (passingBlocks > 0) {
    named.push(`${passingBlocks} passing test block${passingBlocks === 1 ? "" : "s"}`);
  }
  if (preambleLines > 0) {
    named.push(`${preambleLines} preamble line${preambleLines === 1 ? "" : "s"}`);
  }
  if (named.length === 0 || chunks.length === 0) {
    return { chunks, dropped: 0 };
  }
  chunks.push({
    text: `… [${named.join(", ")} omitted — recoverable via stored chunks]`,
    startLine: omittedStart + 1,
    endLine: omittedEnd,
  });
  return { chunks, dropped: passingBlocks + (preambleLines > 0 ? 1 : 0) };
}
