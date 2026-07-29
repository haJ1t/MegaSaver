import { describe, expect, it } from "vitest";
import { type Bm25Document, rankBm25, tokenize } from "../src/bm25.js";
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

describe("tokenize (Task C3 identifier splitting)", () => {
  it("parseConfig produces tokens including parseconfig, parse, config", () => {
    const tokens = tokenize("parseConfig");
    expect(tokens).toContain("parseconfig");
    expect(tokens).toContain("parse");
    expect(tokens).toContain("config");
  });

  it("getUserById produces get, user, by, id (plus whole)", () => {
    const tokens = tokenize("getUserById");
    expect(tokens).toContain("getuserbyid");
    expect(tokens).toContain("get");
    expect(tokens).toContain("user");
    expect(tokens).toContain("by");
    expect(tokens).toContain("id");
  });

  it("auth_token_gen produces auth, token, gen (plus whole)", () => {
    const tokens = tokenize("auth_token_gen");
    expect(tokens).toContain("auth");
    expect(tokens).toContain("token");
    expect(tokens).toContain("gen");
  });

  it("HTTPServer produces http, server (plus whole)", () => {
    const tokens = tokenize("HTTPServer");
    expect(tokens).toContain("httpserver");
    expect(tokens).toContain("http");
    expect(tokens).toContain("server");
  });

  it("utf8 produces utf8 and is not split into utf/8", () => {
    const tokens = tokenize("utf8");
    expect(tokens).toContain("utf8");
    expect(tokens).not.toContain("utf");
    expect(tokens).not.toContain("8");
  });

  it("query for parse ranks a document containing parseConfig above a document containing neither", () => {
    const testDocs = [
      { id: "match", text: "function parseConfig() {}" },
      { id: "other", text: "function processData() {}" },
    ];
    const res = rankBm25({ query: "parse", documents: testDocs, topN: 2 });
    expect(res[0]?.id).toBe("match");
    expect(res[0]?.score).toBeGreaterThan(0);
  });

  it("document containing parseConfig ranks at least as high for query parseConfig as before", () => {
    const testDocs = [
      { id: "target", text: "function parseConfig() {}" },
      { id: "other", text: "unrelated content" },
    ];
    const res = rankBm25({ query: "parseConfig", documents: testDocs, topN: 2 });
    expect(res[0]?.id).toBe("target");
    expect(res[0]?.score).toBeGreaterThan(0);
  });
});
