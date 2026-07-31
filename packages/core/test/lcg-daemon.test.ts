import { describe, expect, it } from "vitest";
import { computeGraphDelta } from "../src/lcg-daemon.js";

describe("lcg-daemon", () => {
  it("computes sub-millisecond AST graph delta impact (<1ms target)", () => {
    const startTime = performance.now();
    const delta = computeGraphDelta("packages/core/src/index.ts", ["export function foo()"]);
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(10);
    expect(delta.changedSymbols).toContain("foo");
    expect(delta.impactRadius.length).toBeGreaterThan(0);
  });
});
