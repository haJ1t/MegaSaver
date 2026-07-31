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

  it("emits addressable EMIT_UNCHANGED_MARKER carrying priorChunkSetId on repeat sight", () => {
    const content = "export function foo() { return 42; }";
    const hash = "hash_abc123";
    const ledger = new Set<string>([hash]);

    const secondDecision = evaluateCacheAlignedTransform(content, hash, ledger, {
      priorChunkSetId: "chunk_set_999",
      priorMeshHandle: "msr://wsk_1/ns_1/hash_abc123#chunk-set",
    });

    expect(secondDecision.action).toBe("EMIT_UNCHANGED_MARKER");
    expect(secondDecision.priorChunkSetId).toBe("chunk_set_999");
    expect(secondDecision.outputContent).toContain('priorChunkSetId="chunk_set_999"');
    expect(secondDecision.outputContent).toContain(
      'priorMeshHandle="msr://wsk_1/ns_1/hash_abc123#chunk-set"',
    );
  });

  it("returns raw PASSTHROUGH when bypassCache option is set", () => {
    const content = "export function bar() { return 100; }";
    const hash = "hash_bypass";
    const ledger = new Set<string>();

    const decision = evaluateCacheAlignedTransform(content, hash, ledger, { bypassCache: true });
    expect(decision.action).toBe("PASSTHROUGH");
    expect(decision.outputContent).toBe(content);
  });

  it("generates I14/E7 single-coordinate recovery markers when requested", () => {
    const content = "export function bar() { return 100; }";
    const hash = "hash_xyz789";
    const ledger = new Set<string>();
    const coords = { rawStartLine: 1, rawEndLine: 10, casHash: hash };

    const decision = evaluateCacheAlignedTransform(content, hash, ledger, { coordinates: coords });
    expect(decision.coordinates).toEqual(coords);
  });
});
