import { describe, expect, it } from "vitest";
import { compressJson } from "../src/compress/json.js";

// A large homogeneous array of objects (> N=20 entries, same shape).
const LARGE_ARRAY = JSON.stringify(
  Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `user-${i}`,
    active: i % 2 === 0,
  })),
  null,
  2,
);

describe("compressJson (structured-data schematizer)", () => {
  describe("large homogeneous array", () => {
    const out = compressJson(LARGE_ARRAY, undefined);

    it("emits an inferred schema with key list and value types", () => {
      expect(out).toContain("id");
      expect(out).toContain("name");
      expect(out).toContain("active");
      expect(out).toContain("number");
      expect(out).toContain("string");
      expect(out).toContain("boolean");
    });

    it("keeps the first 3 elements verbatim", () => {
      expect(out).toContain('"user-0"');
      expect(out).toContain('"user-1"');
      expect(out).toContain('"user-2"');
    });

    it("keeps the last element verbatim", () => {
      expect(out).toContain('"user-99"');
    });

    it("drops middle elements behind a counted marker", () => {
      expect(out).not.toContain('"user-50"');
      expect(out).toMatch(/\[\d+ more of same shape\]/);
    });

    it("reports the correct dropped count (total - 3 first - 1 last)", () => {
      expect(out).toContain("[96 more of same shape]");
    });

    it("is dramatically smaller than the raw input", () => {
      expect(out.length).toBeLessThan(LARGE_ARRAY.length / 2);
    });
  });

  describe("fall-through (unchanged)", () => {
    it("returns a small array (< N) unchanged", () => {
      const small = JSON.stringify(
        Array.from({ length: 5 }, (_, i) => ({ id: i })),
        null,
        2,
      );
      expect(compressJson(small, undefined)).toBe(small);
    });

    it("returns a non-array JSON object unchanged", () => {
      const obj = JSON.stringify({ a: 1, b: 2, c: 3 }, null, 2);
      expect(compressJson(obj, undefined)).toBe(obj);
    });

    it("returns a heterogeneous array unchanged", () => {
      const hetero = JSON.stringify(
        [
          { id: 1, name: "a" },
          { id: 2, type: "b", extra: true },
          ...Array.from({ length: 30 }, () => ({ totally: "different", shape: 1 })),
        ],
        null,
        2,
      );
      expect(compressJson(hetero, undefined)).toBe(hetero);
    });

    it("returns an array of primitives unchanged", () => {
      const prims = JSON.stringify(
        Array.from({ length: 50 }, (_, i) => i),
        null,
        2,
      );
      expect(compressJson(prims, undefined)).toBe(prims);
    });

    it("returns malformed JSON unchanged (no throw)", () => {
      const bad = '{"id": 1, "name": "broken"';
      expect(() => compressJson(bad, undefined)).not.toThrow();
      expect(compressJson(bad, undefined)).toBe(bad);
    });
  });

  describe("intent force-keep", () => {
    it("retains a key matching the intent signal in the schema", () => {
      const arr = JSON.stringify(
        Array.from({ length: 100 }, (_, i) => ({
          id: i,
          email: `u${i}@example.com`,
          token: `secret-${i}`,
        })),
        null,
        2,
      );
      const out = compressJson(arr, "find the email column");
      expect(out).toContain("email");
    });

    it("matches a Turkish key against a Turkish intent across dotless-i (D18 twin)", () => {
      // Key "ışık" and intent "IŞIK" fold to "isik"; the old ASCII split
      // fragmented them to disjoint pieces ({k} vs {i,ik}) and never matched,
      // so this key would not be force-kept before the shared tokenizer.
      const arr = JSON.stringify(
        Array.from({ length: 30 }, (_, i) => ({ id: i, ışık: i % 2 === 0 })),
      );
      const out = compressJson(arr, "IŞIK durumu");
      expect(out).toMatch(/ışık:[^\n]*\(kept: intent\)/);
    });
  });
});
