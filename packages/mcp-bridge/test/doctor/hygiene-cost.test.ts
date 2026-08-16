import { describe, expect, it } from "vitest";
import { scanDescription } from "../../src/doctor/hygiene.js";

// ReDoS-guard discipline (wiki/concepts/redos-guard-testing): the scanner is
// literal-substring only, so cost must stay linear in description bytes.
// SIZE 100 KB / CEILING 5 s mirror output-filter/test/classify-redos.test.ts:
// the ceiling is deliberately loose because this suite runs under a parallel
// `turbo test`; it catches a catastrophic (quadratic) regression, not a
// modest slowdown. Non-vacuity is structural: the planted probe MUST be
// found, proving the scan really traversed the corpus.
const CEILING_MS = 5_000;
const SIZE = 100_000;

describe("scanDescription cost guard", () => {
  it(`scans ${SIZE / 1000} KB of near-miss text under ${CEILING_MS} ms and still finds a planted probe`, () => {
    const corpus = "ignore previou ".repeat(Math.ceil(SIZE / 15)).slice(0, SIZE);
    const started = performance.now();
    const hits = scanDescription(`${corpus} ignore previous`);
    const elapsed = performance.now() - started;
    expect(hits.some((h) => h.kind === "injection")).toBe(true);
    expect(elapsed).toBeLessThan(CEILING_MS);
  });
});
