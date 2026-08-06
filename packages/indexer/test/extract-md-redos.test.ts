import { describe, expect, it } from "vitest";
import { extractMd } from "../src/extract/extract-md.js";

// HEADING_RE was /^#{1,6}\s+(.+?)\s*$/ — the "zero-width literal" variant of
// [[concepts/unbounded-run-redos]] (same shape as instance 8's /\s+$/, fixed the
// same way, with trimEnd()). The lazy (.+?) expands one character at a time and
// each expansion retries \s*$; inside a whitespace run \s* eats to the end of the
// run before $ fails against the non-space that follows, so the run costs O(W^2).
// Anchored ^ without /m gives only one start position, so the blowup is entirely
// internal backtracking rather than the usual per-offset restart.
//
// Untrusted: applied per line to every repo markdown file walked by `mega scan` /
// `mega index`, where scan.ts:20 caps files at 1_000_000 bytes.
//
// Measured through extractMd on this machine, W = whitespace-run length:
//   W=16000  158 ms | W=32000  531 ms | W=64000 1944 ms | W=100000 4052 ms
// Doubling W costs 3.4-3.7x — k^2, quadratic confirmed.
const WHITESPACE_RUN = 100_000;
// Smaller than WHITESPACE_RUN because the unmatchable shape costs W^2 in BOTH the
// whitespace run and the capture: 32,000 already puts the quadratic form 6.3x over
// MAX_MS (1,575 ms) while the fixed form stays at 0.02 ms — separation without
// making a green run pay for it.
const FAILING_RUN = 32_000;

// NOT sized at the 1 MB scan cap, which is where the wiki would normally put it:
// quadratic, the defect needs tens of minutes there, and Vitest cannot interrupt a
// synchronous regex (timeout only fires at async boundaries), so the revert check
// would hang instead of going red. 101 KB was chosen because it buys 16x below red
// while keeping the revert check to ~4 s. The real cap admits ~10x this size, so
// the shipped exposure is worse than what this test reproduces.
const MAX_MS = 250;

// A ceiling, not a growth ratio: [[concepts/redos-growth-ratio-measurement]] makes
// the ratio a fallback for when size cannot buy separation, and here it buys five
// orders of magnitude — 4052 ms defect vs 0.139 ms fixed, both through extractMd,
// a 29,213x gap. 250 ms sits 1,802x above the fixed cost and 16.2x below the
// defect, matching that page's worked example. A ratio would be the wrong
// instrument in a suite that runs under turbo's full fan-out, and the 50 ms
// ceiling a naive reading suggests would sit only ~2.5x from a 124 ms reading of
// the defect — the "passes while broken" margin that page was written to prevent.
//
// Both verdicts were reproduced, not estimated: reverting HEADING_RE to the lazy
// form fails this assertion at 4657 ms on all four attempts, and the fixed form
// runs the whole file in 2 ms idle and 3-4 ms under four busy cores (3/3 green).
const pathologicalLine = `# ${"a".repeat(1000)}${" ".repeat(WHITESPACE_RUN)}x`;

describe("extractMd — quadratic backtracking in the heading regex", () => {
  // retry: 3 matches every other timing guard in this repo. It cannot weaken the
  // gate: the quadratic form is slow on every attempt, so it still fails all three.
  // The explicit 60 s timeout is load-bearing — the file default is 30 s, and a
  // revert must fail on the assertion, not on a timeout, to prove anything.
  it(
    `parses a ${Math.round(pathologicalLine.length / 1000)} KB heading line under ${MAX_MS} ms`,
    { retry: 3, timeout: 60_000 },
    () => {
      const started = performance.now();
      const blocks = extractMd("docs/hostile.md", pathologicalLine);
      const elapsed = performance.now() - started;

      // Asserted beside the ceiling: a "fix" that simply stopped matching headings
      // would be fast and would sail through a bare timing assertion.
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.name).toBe(`${"a".repeat(1000)}${" ".repeat(WHITESPACE_RUN)}x`);
      expect(elapsed).toBeLessThan(MAX_MS);
    },
  );

  // The vector the FIRST fix missed, and the reason a second round was needed.
  // The case above is fast the moment the line MATCHES — the engine stops. The
  // expensive case is a line that cannot match at all, because then every
  // (whitespace-run x capture) split gets tried before the engine gives up.
  // `\r` mid-line guarantees failure: `.` excludes it and `$` (no /m) needs true
  // end of input. Measured on this exact shape at W=32,000:
  //   /^#{1,6}\s+(.+?)\s*$/  cubic     (ratio ~8.0 per doubling; 67 s at W=8,000)
  //   /^#{1,6}\s+(.+)\r?$/   quadratic (ratio ~3.9 per doubling; 1,575 ms)
  //   /^(#{1,6})\s/ + slice  linear    (0.02 ms)
  // Any future form that reintroduces a second unbounded quantifier fails here.
  const unmatchableLine = `#${" ".repeat(FAILING_RUN)}${"x".repeat(FAILING_RUN)}\r y`;

  it(
    `abandons a ${Math.round(unmatchableLine.length / 1000)} KB UNMATCHABLE heading line under ${MAX_MS} ms`,
    { retry: 3, timeout: 60_000 },
    () => {
      const started = performance.now();
      const blocks = extractMd("docs/hostile.md", unmatchableLine);
      const elapsed = performance.now() - started;

      // Asserted beside the ceiling for the same reason as above: the line must
      // still be rejected, not merely rejected quickly.
      expect(blocks).toEqual([]);
      expect(elapsed).toBeLessThan(MAX_MS);
    },
  );
});

describe("extractMd — heading behaviour preserved across the fix", () => {
  const nameOf = (line: string): string | undefined => extractMd("d.md", line)[0]?.name;

  it("captures ordinary heading names unchanged at every level", () => {
    expect(nameOf("# Title")).toBe("Title");
    expect(nameOf("## Sub Head")).toBe("Sub Head");
    expect(nameOf("###### Six")).toBe("Six");
    expect(nameOf("#\tTab Title")).toBe("Tab Title");
  });

  it("still strips trailing whitespace but keeps interior runs", () => {
    expect(nameOf("# Trailing   ")).toBe("Trailing");
    expect(nameOf("# Trailing\t\t")).toBe("Trailing");
    expect(nameOf("#   Lots   of   spaces   ")).toBe("Lots   of   spaces");
  });

  it("does not treat non-headings as headings", () => {
    expect(extractMd("d.md", "#")).toEqual([]);
    expect(extractMd("d.md", "###")).toEqual([]);
    expect(extractMd("d.md", "#NoSpace")).toEqual([]);
    expect(extractMd("d.md", "####### Seven hashes")).toEqual([]);
    expect(extractMd("d.md", "   # Indented")).toEqual([]);
    expect(extractMd("d.md", "Not a heading")).toEqual([]);
  });

  // The trap in the obvious rewrite. /^#{1,6}\s+(.*)$/ — the shape a quick fix
  // reaches for — MATCHES these two, because (.*) accepts empty where the old
  // (.+?) required a character. That invents a heading on a hash followed only by
  // whitespace, shifting block count, the "(intro)" boundary and the preceding
  // block's endLine. (.+) is what keeps match/no-match identical, so this is the
  // case that chooses the regex. Do not relax it to (.*).
  it("rejects a hash line that is only whitespace after the hashes", () => {
    expect(extractMd("d.md", "# ")).toEqual([]);
    expect(extractMd("d.md", "#\t")).toEqual([]);
  });

  // The one accepted divergence, and it is a DELIBERATE change, not a preserved
  // quirk. Three forms disagreed here, so there was no "keep the old behaviour"
  // option to take:
  //   /^#{1,6}\s+(.+?)\s*$/  accepted "#  " with name " "  (\s+ gives back one char)
  //   /^#{1,6}\s+(.+)\r?$/   accepted "#  " with name ""   (trimEnd of that space)
  //   /^(#{1,6})\s/ + slice  rejects it
  // The sibling case above already rejects "# " and "#\t", so accepting "#  " was
  // purely an artifact of how much the whitespace run had to surrender. Dropping
  // it makes one rule — a heading needs a non-whitespace name — instead of a rule
  // plus an exception for two-or-more spaces. The change is one-way: it can only
  // drop a nameless heading, never invent one.
  it("rejects a hash line that is only whitespace, however long the run", () => {
    expect(extractMd("d.md", "#  ")).toEqual([]);
    expect(extractMd("d.md", "#   \t  ")).toEqual([]);
    expect(nameOf("#  ")).toBeUndefined();
  });

  // The second trap, and the more damaging one: `.` excludes \r, and `$` without
  // /m matches only at true end of input (unlike Python's, which tolerates a
  // trailing terminator). extractMd splits on "\n", so every line of a CRLF file
  // arrives with \r still attached — and /^#{1,6}\s+(.+)$/ then matches none of
  // them. A Windows checkout would index to zero docs blocks with no error at all.
  // The old regex survived this only because \r is in \s, so its \s*$ ate it.
  it("parses headings in a CRLF file", () => {
    expect(nameOf("# Title\r")).toBe("Title");
    expect(nameOf("## Sub\r")).toBe("Sub");
    expect(nameOf("# Trailing   \r")).toBe("Trailing");

    const crlf = extractMd("d.md", "intro\r\n\r\n# One\r\nbody\r\n\r\n## Two   \r\nmore\r\n");
    const lf = extractMd("d.md", "intro\n\n# One\nbody\n\n## Two   \nmore\n");

    expect(crlf.map((b) => b.name)).toEqual(["(intro)", "One", "Two"]);
    expect(crlf.map((b) => b.startLine)).toEqual(lf.map((b) => b.startLine));
  });

  // A lone \r inside the text is still not a heading, exactly as before — this is
  // what rules out the other tempting rewrite, ([\s\S]+), which would match here
  // and hand a multi-line name to a CR-only-line-ending file.
  it("does not treat a line with an interior carriage return as a heading", () => {
    expect(extractMd("d.md", "# Ti\rtle")).toEqual([]);
    expect(extractMd("d.md", "# \r")).toEqual([]);
  });

  it("keeps multi-heading block boundaries intact", () => {
    const blocks = extractMd("d.md", "intro text\n\n# One\nbody\n\n## Two   \nmore\n");

    expect(blocks.map((b) => b.name)).toEqual(["(intro)", "One", "Two"]);
    expect(blocks[1]?.startLine).toBe(3);
    expect(blocks[1]?.endLine).toBe(5);
    expect(blocks[2]?.startLine).toBe(6);
  });
});
