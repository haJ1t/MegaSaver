import { describe, expect, it } from "vitest";
import { compressJson } from "../src/compress/json.js";
import { compressProse } from "../src/compress/prose.js";

// B9: the D20 prose trade-off is a conscious accept — what changes is the
// honesty of the promise. Collapsed spans are named AND the output says the
// omitted content is recoverable; compressJson's "(kept: intent)" annotation
// must mean values are actually preserved, not merely annotated.

describe("compressProse — collapsed spans declare recoverability (B9)", () => {
  const LONG_DOC = [
    "# Guide",
    "",
    "First paragraph of the intro section, long enough to carry real weight here.",
    "",
    "Second paragraph with all the details that get collapsed behind a marker.",
    "",
    "Third paragraph with even more detail that also collapses away from view.",
    "",
    "## Next",
    "",
    "Only paragraph of the second section, also deliberately wordy to pass the",
    "short-doc floor so compression actually engages on this fixture document.",
    "One more sentence pushing the fixture well past five hundred characters,",
    "because the short-doc pass-through must not fire for this test to mean",
    "anything at all about collapse markers and recoverability notes.",
  ].join("\n");

  it("a doc with collapsed spans ends with a recoverability note", () => {
    const out = compressProse(LONG_DOC);
    expect(out).toMatch(/… \[\d+ paragraphs?\]/);
    expect(out.trimEnd().endsWith("… [collapsed spans recoverable via stored chunks]")).toBe(true);
  });

  it("a doc compressed only by a long list also gets the note", () => {
    const doc = ["# L", "", "- a", "- b", "- c", "- d", "- e"].join("\n");
    const out = compressProse(doc);
    expect(out).toContain("… [2 more items]");
    expect(out.trimEnd().endsWith("… [collapsed spans recoverable via stored chunks]")).toBe(true);
  });

  it("a short doc passing through unchanged carries no note", () => {
    const doc = "# Tiny\n\nOne paragraph.";
    expect(compressProse(doc)).toBe(doc);
  });
});

describe("compressJson — intent-matched values are actually preserved (B9)", () => {
  const ROWS = JSON.stringify(
    Array.from({ length: 25 }, (_, i) => ({ id: i, name: `row-${i}`, blob: `x${i}` })),
  );

  it("emits every value of an intent-matched scalar key, not just samples", () => {
    const out = compressJson(ROWS, "list the name values");
    expect(out).toContain('"row-24"');
    expect(out).toContain('"row-7"');
    expect(out).toContain('"row-12"');
  });

  it("non-matched middle values stay dropped behind the counted marker", () => {
    const out = compressJson(ROWS, "list the name values");
    expect(out).not.toContain('"x12"');
    expect(out).toMatch(/\[\d+ more of same shape/);
  });

  it("a non-scalar intent key is annotated honestly, not as kept", () => {
    const arr = JSON.stringify(
      Array.from({ length: 25 }, (_, i) => ({ id: i, meta: { rank: i } })),
    );
    const out = compressJson(arr, "show meta");
    expect(out).not.toContain("(kept: intent)");
    expect(out).toMatch(/meta:[^\n]*not preserved/);
  });

  it("the dropped-rows marker declares recoverability", () => {
    const out = compressJson(ROWS, undefined);
    expect(out).toContain("recoverable via stored chunks");
  });
});
