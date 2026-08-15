import { describe, expect, it } from "vitest";
import { NPM_TOP } from "../src/data/npm-top.js";
import { nearestKnownName, osaDistanceAtMost } from "../src/package-typosquat.js";

describe("osaDistanceAtMost", () => {
  it("computes edit distances and transpositions", () => {
    expect(osaDistanceAtMost("abc", "abc", 2)).toBe(0);
    expect(osaDistanceAtMost("lodahs", "lodash", 2)).toBe(1); // transposition
    expect(osaDistanceAtMost("reqeusts", "requests", 2)).toBe(1);
    expect(osaDistanceAtMost("left-padd", "left-pad", 2)).toBe(1);
    expect(osaDistanceAtMost("expresss", "express", 2)).toBe(1);
    expect(osaDistanceAtMost("numpyy", "numpy", 2)).toBe(1);
  });
  it("returns null when the distance exceeds max (early abandon)", () => {
    expect(osaDistanceAtMost("abc", "xyz", 1)).toBeNull();
    expect(osaDistanceAtMost("a", "aaaa", 2)).toBeNull(); // length prefilter
  });
});

describe("nearestKnownName", () => {
  it("hints at distance 1 only (architect m8)", () => {
    expect(nearestKnownName("lodahs", NPM_TOP)).toBe("lodash");
    expect(nearestKnownName("reqeusts", ["requests"])).toBe("requests");
    expect(nearestKnownName("left-padd", NPM_TOP)).toBe("left-pad");
    expect(nearestKnownName("reqeustss", ["requests"])).toBeNull(); // distance 2
    expect(nearestKnownName("wildlynotreal", NPM_TOP)).toBeNull();
  });
  it("never flags exact-known names", () => {
    expect(nearestKnownName("react", NPM_TOP)).toBeNull();
    expect(nearestKnownName("lodash", NPM_TOP)).toBeNull();
  });
});
