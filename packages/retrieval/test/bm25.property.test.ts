import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Bm25Document, rankBm25 } from "../src/bm25.js";

const wordArb = fc.constantFrom("alpha", "beta", "gamma", "delta", "epsilon", "zeta");

const docArb = fc.record({
  id: fc.uuid(),
  text: fc.array(wordArb, { minLength: 1, maxLength: 8 }).map((w) => w.join(" ")),
});

const docsArb = fc.array(docArb, { minLength: 1, maxLength: 20 }).filter((ds) => {
  const ids = new Set(ds.map((d) => d.id));
  return ids.size === ds.length;
});

describe("rankBm25 properties", () => {
  it("output length is always min(topN, documents.length)", () => {
    fc.assert(
      fc.property(docsArb, fc.integer({ min: 1, max: 30 }), (documents, topN) => {
        const result = rankBm25({ query: "alpha beta", documents, topN });
        expect(result).toHaveLength(Math.min(topN, documents.length));
      }),
    );
  });

  it("result is permutation-invariant as a set of ids", () => {
    fc.assert(
      fc.property(docsArb, (documents) => {
        const shuffled = [...documents].reverse();
        const a = rankBm25({ query: "alpha beta", documents, topN: documents.length });
        const b = rankBm25({ query: "alpha beta", documents: shuffled, topN: documents.length });
        expect(new Set(a.map((r) => r.id))).toEqual(new Set(b.map((r) => r.id)));
      }),
    );
  });

  it("scores are sorted in non-increasing order", () => {
    fc.assert(
      fc.property(docsArb, (documents) => {
        const result = rankBm25({ query: "alpha", documents, topN: documents.length });
        const scores = result.map((r) => r.score);
        const sorted = [...scores].sort((a, b) => b - a);
        expect(scores).toEqual(sorted);
      }),
    );
  });
});
