import { describe, expect, it } from "vitest";
import { bundleIdOf, canonicalJson, evidenceBundleSchema } from "../../src/bundle/schema.js";

describe("bundle schema", () => {
  it("rejects extra key", () => {
    const bad = { version: 1, bundleId: "abc123abc123", createdAt: new Date().toISOString(), git: { base: null, head: "HEAD", baseOid: null, headOid: null }, preflight: null, sweep: null, tests: { receipts: [], verified: false }, context: null, lineage: { bundleHash: "h", storeRootHash: "h" }, redacted: true, extra: 1 };
    expect(evidenceBundleSchema.safeParse(bad).success).toBe(false);
  });

  it("canonicalJson stable", () => {
    expect(canonicalJson({ b: 1, a: 1 })).toBe(canonicalJson({ a: 1, b: 1 }));
  });

  it("same payload same bundleId", () => {
    const base = { version: 1 as const, createdAt: new Date().toISOString(), git: { base: null, head: "HEAD", baseOid: null, headOid: null }, preflight: null, sweep: null, tests: { receipts: [], verified: false }, context: null, lineage: { bundleHash: "h", storeRootHash: "h" }, redacted: true };
    expect(bundleIdOf(base as any)).toBe(bundleIdOf(base as any));
  });
});
