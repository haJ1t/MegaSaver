import { describe, expect, it } from "vitest";
import { cosine } from "../src/cosine.js";
import { embed } from "../src/embed.js";

// Gated: this is the ONLY test that loads the model and (on first run)
// downloads it. CI never sets MEGA_EMBED_E2E, so it is skipped there.
// Run locally with: MEGA_EMBED_E2E=1 pnpm --filter @megasaver/embeddings test
describe.skipIf(!process.env.MEGA_EMBED_E2E)("embed (model run)", () => {
  it("returns one normalized 384-dim vector per input", async () => {
    const [v] = await embed(["hello world"]);
    expect(v).toBeInstanceOf(Float32Array);
    expect(v?.length).toBe(384);
    const norm = Math.sqrt(Array.from(v ?? []).reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it("ranks similar text above dissimilar text", async () => {
    const [a, b, c] = await embed([
      "the cat sat on the mat",
      "a kitten rested on the rug",
      "quarterly financial earnings report",
    ]);
    expect(cosine(a as Float32Array, b as Float32Array)).toBeGreaterThan(
      cosine(a as Float32Array, c as Float32Array),
    );
  });
});
