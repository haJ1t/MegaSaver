import { describe, expect, it } from "vitest";
import { bundleIdOf } from "../../src/bundle/schema.js";

describe("pr bundle", () => {
  it("bundleId deterministic", () => {
    const base = { version: 1 as const, createdAt: new Date().toISOString(), git: { base: null, head: "HEAD", baseOid: null, headOid: null }, preflight: null, sweep: null, tests: { receipts: [], verified: false }, context: null, lineage: { bundleHash: "h", storeRootHash: "h" }, redacted: true };
    expect(bundleIdOf(base as any)).toBe(bundleIdOf(base as any));
  });
});
