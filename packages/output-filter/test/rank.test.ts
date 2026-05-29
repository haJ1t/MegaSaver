import { describe, expect, it } from "vitest";
import { rankFeatureNameSchema } from "../src/rank-features.js";
import { type Chunk, scoreChunk } from "../src/rank.js";

const chunk = (text: string): Chunk => ({ text, startLine: 1, endLine: 1 });

describe("scoreChunk (spec §6 stage 5)", () => {
  it("returns a RankFeatures record keyed by every RankFeatureName", () => {
    const ranked = scoreChunk("find the bug", chunk("hello"));
    for (const name of rankFeatureNameSchema.options) {
      expect(ranked.features).toHaveProperty(name);
      expect(typeof ranked.features[name]).toBe("number");
    }
  });

  it("scores an error line above plain noise", () => {
    const err = scoreChunk(undefined, chunk("Error: something failed"));
    const noise = scoreChunk(undefined, chunk("ok ok ok ok"));
    expect(err.score).toBeGreaterThan(noise.score);
  });

  it("scores a TS diagnostic line above plain noise", () => {
    const diag = scoreChunk(undefined, chunk("src/x.ts(1,1): error TS2322: nope"));
    const noise = scoreChunk(undefined, chunk("ok ok ok ok"));
    expect(diag.score).toBeGreaterThan(noise.score);
  });

  it("scores a stacktrace line above plain noise", () => {
    const trace = scoreChunk(undefined, chunk("    at fn (/app/x.ts:10:5)"));
    const noise = scoreChunk(undefined, chunk("ok ok ok ok"));
    expect(trace.score).toBeGreaterThan(noise.score);
  });

  it("rewards intent keyword matches", () => {
    const hit = scoreChunk("database connection", chunk("database connection refused"));
    const miss = scoreChunk("database connection", chunk("unrelated text here"));
    expect(hit.features.keywordScore).toBeGreaterThan(miss.features.keywordScore);
  });

  it("rewards chunks referencing recent session files", () => {
    const hint = { recentFiles: ["src/target.ts"] as const };
    const hit = scoreChunk(undefined, chunk("touched src/target.ts"), hint);
    expect(hit.features.recentFileScore).toBeGreaterThan(0);
  });

  it("expresses penalties as positive magnitudes", () => {
    const ranked = scoreChunk(undefined, chunk("noise"));
    expect(ranked.features.duplicatePenalty).toBeGreaterThanOrEqual(0);
    expect(ranked.features.noisePenalty).toBeGreaterThanOrEqual(0);
  });
});
