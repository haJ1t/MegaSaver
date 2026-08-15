import { describe, expect, it } from "vitest";
import { MAX_FAILURES_INPUT_BYTES, scanRefs } from "../../src/commands/failures/scan-refs.js";

describe("scanRefs — chunk refs", () => {
  it("finds cs- ids, dedupes, preserves first-seen order", () => {
    const a = `cs-${"a1f0".repeat(8)}`; // 32 hex — the saver's content-derived shape
    const b = `cs-${"0".repeat(12)}`;
    const refs = scanRefs(`see ${a} then ${b} and ${a} again`);
    expect(refs.chunkRefs).toEqual([a, b]);
  });

  it("rejects non-hex, too-short, uppercase, and embedded ids", () => {
    expect(scanRefs("cs-zzzzzzzz cs-1234567 xcs-aaaaaaaa cs-ABCDEF12").chunkRefs).toEqual([]);
  });
});

describe("scanRefs — path refs", () => {
  it("accepts slash paths and dotted filenames, strips quotes and trailing punctuation", () => {
    const refs = scanRefs('updated "src/commands/alerts.ts", package.json and ./docs/x.md.');
    expect(refs.pathRefs).toEqual(["src/commands/alerts.ts", "package.json", "./docs/x.md"]);
  });

  it("ignores prose, abbreviations, URLs, and over-long tokens", () => {
    const long = `a/${"b".repeat(600)}`;
    const refs = scanRefs(`plain words, e.g. i.e. https://example.com/a/b and ${long}`);
    expect(refs.pathRefs).toEqual([]);
  });

  it("exposes the shipped input cap", () => {
    expect(MAX_FAILURES_INPUT_BYTES).toBe(8_388_608);
  });
});
