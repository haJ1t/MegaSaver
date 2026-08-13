import { expect } from "vitest";
import type { CommandFilter } from "../../src/filters/index.js";

// Shared gate every registry filter passes before it ships (spec D5/D6):
// determinism, empty-input no-op, the line-subset claim, declared-marker
// grammar, and real compression on the fixture. Returns the compressed text
// so callers add filter-specific assertions on the same output.
export function assertFilterConformance(filter: CommandFilter, fixture: string): string {
  expect(filter.integrity).toBe("line-subset");
  const out = filter.compress(fixture);
  expect(filter.compress(fixture), "filter must be deterministic").toBe(out);
  expect(filter.compress(""), "empty input must be a no-op").toBe("");
  for (const m of filter.markers) {
    expect(m.source.startsWith("^… \\["), `marker not anchored to '… [': ${m}`).toBe(true);
    expect(m.source.endsWith("\\]$"), `marker not closed: ${m}`).toBe(true);
    expect(m.flags, `marker regexes must be flagless: ${m}`).toBe("");
  }
  const inputLines = new Set(fixture.split("\n").map((l) => l.trim()));
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (t === "" || inputLines.has(t)) continue;
    expect(
      filter.markers.some((m) => m.test(t)),
      `synthesized line is not a declared marker: ${JSON.stringify(line)}`,
    ).toBe(true);
  }
  expect(
    Buffer.byteLength(out, "utf8"),
    "the conformance fixture must actually compress",
  ).toBeLessThan(Buffer.byteLength(fixture, "utf8"));
  // Review P1: a trailing newline must survive unchanged (compression may
  // only fold lines, never reshape the input's line terminator) — otherwise
  // a pure no-op on newline-terminated output mislabels the compressor.
  expect(filter.compress(`${fixture}\n`), "trailing newline must survive").toBe(`${out}\n`);
  return out;
}
