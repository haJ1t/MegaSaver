import { describe, expect, it } from "vitest";
import { semanticDiffChunks } from "../src/semantic-diff.js";

const TWO_FNS =
  "export function alpha(): number {\n  return 1;\n}\n\nexport function beta(): number {\n  return 2;\n}\n";

describe("semanticDiffChunks", () => {
  it("keeps only declaration chunks overlapping the changed ranges", async () => {
    const chunks = await semanticDiffChunks({
      path: "alpha.ts",
      headText: TWO_FNS,
      ranges: [{ start: 6, end: 6 }], // inside beta only
    });
    expect(chunks.some((c) => c.text.includes("beta"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("alpha("))).toBe(false);
  });

  it("falls back to line chunks for unsupported extensions", async () => {
    const chunks = await semanticDiffChunks({
      path: "notes.xyz",
      headText: "l1\nl2\nl3\n",
      ranges: [{ start: 2, end: 2 }],
    });
    expect(chunks).toHaveLength(1); // one 40-line window covers it
  });
});
