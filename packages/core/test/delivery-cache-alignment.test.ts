import { describe, expect, it } from "vitest";
import { evaluateCacheAlignedTransform } from "../src/delivery-cache-alignment.js";

describe("delivery-cache-alignment", () => {
  it("applies transform and atomically registers hash on first sight", () => {
    const content = "export function foo() { return 42; }";
    const hash = "hash_abc123";
    const ledger = new Set<string>();

    const firstDecision = evaluateCacheAlignedTransform(content, hash, ledger);
    expect(firstDecision.action).toBe("TRANSFORM_FIRST_SIGHT");
    expect(ledger.has(hash)).toBe(true);
  });

  it("emits raw PASSTHROUGH on repeat sight to preserve prompt cache zero-churn", () => {
    const content = "export function foo() { return 42; }";
    const hash = "hash_abc123";
    const ledger = new Set<string>([hash]);

    const secondDecision = evaluateCacheAlignedTransform(content, hash, ledger);
    expect(secondDecision.action).toBe("PASSTHROUGH");
    expect(secondDecision.outputContent).toBe(content);
  });

  it("generates I14/E7 single-coordinate recovery markers when requested", () => {
    const content = "export function bar() { return 100; }";
    const hash = "hash_xyz789";
    const ledger = new Set<string>();
    const coords = { rawStartLine: 1, rawEndLine: 10, casHash: hash };

    const decision = evaluateCacheAlignedTransform(content, hash, ledger, coords);
    expect(decision.coordinates).toEqual(coords);
  });
});
