// Tests that the server-owned expansion-guard Set is bounded (FIFO eviction
// when over cap). Per-session keying is NOT implemented because sessionId is
// not carried in mega_fetch_chunk args — see WHY comment in server.ts.
import { describe, expect, it } from "vitest";
import { BoundedSet, EXPANSION_GUARD_CAP } from "../../src/server.js";

describe("EXPANSION_GUARD_CAP constant", () => {
  it("is a positive integer no larger than 65536", () => {
    expect(EXPANSION_GUARD_CAP).toBeTypeOf("number");
    expect(Number.isInteger(EXPANSION_GUARD_CAP)).toBe(true);
    expect(EXPANSION_GUARD_CAP).toBeGreaterThan(0);
    expect(EXPANSION_GUARD_CAP).toBeLessThanOrEqual(65536);
  });
});

describe("BoundedSet — FIFO eviction at cap", () => {
  it("accepts entries up to the cap without eviction", () => {
    const s = new BoundedSet(3);
    s.add("a");
    s.add("b");
    s.add("c");
    expect(s.has("a")).toBe(true);
    expect(s.has("b")).toBe(true);
    expect(s.has("c")).toBe(true);
  });

  it("evicts the OLDEST entry when cap is exceeded (FIFO)", () => {
    const s = new BoundedSet(3);
    s.add("a");
    s.add("b");
    s.add("c");
    // Adding a 4th evicts "a" (oldest).
    s.add("d");
    expect(s.has("a")).toBe(false); // evicted
    expect(s.has("b")).toBe(true);
    expect(s.has("c")).toBe(true);
    expect(s.has("d")).toBe(true);
  });

  it("never grows beyond cap after many additions", () => {
    const cap = 10;
    const s = new BoundedSet(cap);
    // Add 3x cap entries: only the last `cap` survive.
    for (let i = 0; i < cap * 3; i++) {
      s.add(`cs-${i}`);
    }
    // First 2*cap entries must all be evicted.
    for (let i = 0; i < cap * 2; i++) {
      expect(s.has(`cs-${i}`)).toBe(false);
    }
    // Last `cap` entries must all be present.
    for (let i = cap * 2; i < cap * 3; i++) {
      expect(s.has(`cs-${i}`)).toBe(true);
    }
  });

  it("is idempotent: re-adding an existing id does not change order or count", () => {
    const s = new BoundedSet(3);
    s.add("a");
    s.add("b");
    s.add("a"); // re-add: no-op
    s.add("c");
    // No eviction should have happened — "a" is still present (cap=3, effective count=3).
    expect(s.has("a")).toBe(true);
    expect(s.has("b")).toBe(true);
    expect(s.has("c")).toBe(true);
  });

  it("asReadonlySet returns a Set containing exactly the live entries", () => {
    const s = new BoundedSet(2);
    s.add("x");
    s.add("y");
    s.add("z"); // evicts "x"
    const ro = s.asReadonlySet();
    expect(ro.has("x")).toBe(false);
    expect(ro.has("y")).toBe(true);
    expect(ro.has("z")).toBe(true);
    expect(ro.size).toBe(2);
  });
});
