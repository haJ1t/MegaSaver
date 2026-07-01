import { describe, expect, it } from "vitest";
import { type SessionHints, applyEngineRanking, scoreChunk } from "../src/rank.js";

const chunk = (text: string) => ({ text, startLine: 1, endLine: 1 });
const hints: SessionHints = { recentMemory: ["useAuthToken"], recentFailures: ["TS2322"] };

describe("engine ranking determinism + evidence guard", () => {
  it("produces identical ranking order across runs", () => {
    const build = () =>
      applyEngineRanking(
        [
          scoreChunk("auth", chunk("Error: useAuthToken failed with TS2322"), hints),
          scoreChunk("auth", chunk("plain unrelated noise"), hints),
          scoreChunk("auth", chunk("second failure near TS2322 line 42"), hints),
        ],
        hints,
      );
    expect(build().map((c) => c.text)).toEqual(build().map((c) => c.text));
  });

  it("does not fold two chunks with distinct error codes", () => {
    const ranked = applyEngineRanking(
      [scoreChunk("e", chunk("boom TS2322"), hints), scoreChunk("e", chunk("boom TS7053"), hints)],
      hints,
    );
    const texts = ranked.map((c) => c.text).join("\n");
    expect(texts).toContain("TS2322");
    expect(texts).toContain("TS7053");
  });
});
