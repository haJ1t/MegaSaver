import { describe, expect, it } from "vitest";
import { type Bm25Document, rankBm25 } from "../src/bm25.js";
import { RetrievalError } from "../src/errors.js";

const docs: Bm25Document[] = [
  { id: "d0", text: "the quick brown fox" },
  { id: "d1", text: "the lazy dog sleeps" },
  { id: "d2", text: "quick quick fox fox jumps" },
  { id: "d3", text: "unrelated content about cats" },
];

describe("rankBm25", () => {
  it("is deterministic: identical input yields identical ordered output", () => {
    const input = { query: "quick fox", documents: docs, topN: 4 };
    expect(rankBm25(input)).toEqual(rankBm25(input));
  });

  it("ranks documents with more query-term frequency higher", () => {
    const result = rankBm25({ query: "quick fox", documents: docs, topN: 4 });
    expect(result[0]?.id).toBe("d2");
  });

  it("returns at most topN results", () => {
    const result = rankBm25({ query: "quick", documents: docs, topN: 2 });
    expect(result).toHaveLength(2);
  });

  it("result length is min(topN, documents.length)", () => {
    const result = rankBm25({ query: "quick", documents: docs, topN: 10 });
    expect(result).toHaveLength(4);
  });

  it("empty query yields all-zero scores in original index order, truncated to topN", () => {
    const result = rankBm25({ query: "", documents: docs, topN: 3 });
    expect(result.map((r) => r.id)).toEqual(["d0", "d1", "d2"]);
    expect(result.every((r) => r.score === 0)).toBe(true);
  });

  it("breaks ties by ascending original index (stable)", () => {
    const tied: Bm25Document[] = [
      { id: "a", text: "match" },
      { id: "b", text: "match" },
      { id: "c", text: "match" },
    ];
    const result = rankBm25({ query: "match", documents: tied, topN: 3 });
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("throws RetrievalError on non-positive topN", () => {
    expect(() => rankBm25({ query: "x", documents: docs, topN: 0 })).toThrow(RetrievalError);
  });

  it("throws RetrievalError on non-finite k1", () => {
    expect(() =>
      rankBm25({ query: "x", documents: docs, topN: 2, k1: Number.POSITIVE_INFINITY }),
    ).toThrow(RetrievalError);
  });

  it("throws RetrievalError on non-finite b", () => {
    expect(() => rankBm25({ query: "x", documents: docs, topN: 2, b: Number.NaN })).toThrow(
      RetrievalError,
    );
  });

  it("error carries invalid_input code", () => {
    try {
      rankBm25({ query: "x", documents: docs, topN: -1 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RetrievalError);
      expect((err as RetrievalError).code).toBe("invalid_input");
    }
  });
});
