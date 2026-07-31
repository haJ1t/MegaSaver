import { describe, expect, it } from "vitest";
import { computeGraphDeltaScaffold } from "../src/lcg-daemon.js";

describe("lcg-daemon (Scaffold Check)", () => {
  it("computes AST graph delta scaffold without fake impact radius assumptions", () => {
    const startTime = performance.now();
    const delta = computeGraphDeltaScaffold("packages/core/src/index.ts", [
      "export function foo()",
    ]);
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(10);
    expect(delta.isScaffold).toBe(true);
    expect(delta.changedSymbols).toEqual(["foo"]);
    expect(delta.impactRadius).toEqual([]);
  });

  it("returns empty changedSymbols when no function pattern is matched", () => {
    const delta = computeGraphDeltaScaffold("file.ts", ["const x = 123;"]);
    expect(delta.changedSymbols).toEqual([]);
  });
});
