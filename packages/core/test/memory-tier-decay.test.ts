import { describe, expect, it } from "vitest";
import {
  type MemoryEntry,
  type MemoryTier,
  effectiveConfidence,
  isArchived,
  isRecallable,
  memoryEntrySchema,
  memoryEntryUpdatePatchSchema,
  memoryTierSchema,
  overlayMemoryEntrySchema,
  sweepMemoryTiers,
  tierOf,
} from "../src/memory-entry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ID_A = "33333333-3333-4333-8333-333333333333";
const ID_B = "44444444-4444-4444-8444-444444444444";
const ID_C = "55555555-5555-4555-8555-555555555555";

const NOW = "2026-06-30T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z"; // ~180 days before NOW
const RECENT = "2026-06-29T00:00:00.000Z"; // ~1 day before NOW

function mem(over: Partial<Record<string, unknown>> = {}): MemoryEntry {
  return memoryEntrySchema.parse({
    id: ID_A,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use JWT middleware",
    content: "Repo uses strict ESM.",
    keywords: ["auth"],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: RECENT,
    updatedAt: RECENT,
    ...over,
  });
}

describe("memoryTierSchema", () => {
  it("accepts working / recall / archival", () => {
    for (const t of ["working", "recall", "archival"] satisfies MemoryTier[]) {
      expect(memoryTierSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown tiers", () => {
    expect(memoryTierSchema.safeParse("cold").success).toBe(false);
  });
});

describe("tier schema back-compat", () => {
  it("parses a record with an explicit tier on both variants", () => {
    expect(mem({ tier: "working" }).tier).toBe("working");
    const overlay = overlayMemoryEntrySchema.parse({
      id: ID_A,
      workspaceKey: "ws",
      liveSessionId: null,
      scope: "project",
      type: "decision",
      title: "t",
      content: "c",
      keywords: [],
      confidence: "high",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: RECENT,
      updatedAt: RECENT,
      tier: "archival",
    });
    expect(overlay.tier).toBe("archival");
  });

  it("treats an absent tier as recall (old records keep loading)", () => {
    const legacy = mem(); // no tier field
    expect(legacy.tier).toBeUndefined();
    expect(tierOf(legacy)).toBe("recall");
    expect(isArchived(legacy)).toBe(false);
  });

  it("accepts tier in the update patch (sweep mutates it)", () => {
    const patch = memoryEntryUpdatePatchSchema.parse({
      tier: "archival",
      updatedAt: NOW,
    });
    expect(patch.tier).toBe("archival");
  });
});

describe("isRecallable tier-awareness (rides the centralized predicate)", () => {
  it("returns working and recall memories normally", () => {
    expect(isRecallable(mem({ tier: "working" }), NOW)).toBe(true);
    expect(isRecallable(mem({ tier: "recall" }), NOW)).toBe(true);
    expect(isRecallable(mem(), NOW)).toBe(true); // absent ⇒ recall
  });

  it("excludes archival by default", () => {
    expect(isRecallable(mem({ tier: "archival" }), NOW)).toBe(false);
  });

  it("includes archival only with includeArchival", () => {
    expect(isRecallable(mem({ tier: "archival" }), NOW, { includeArchival: true })).toBe(true);
  });

  it("still gates approval+validity for archival when explicitly included", () => {
    // archival + unapproved ⇒ still not recallable even with includeArchival.
    expect(
      isRecallable(mem({ tier: "archival", approval: "suggested" }), NOW, {
        includeArchival: true,
      }),
    ).toBe(false);
  });
});

describe("effectiveConfidence (read-time decay, pinned now)", () => {
  it("decreases monotonically as the memory ages", () => {
    const base = mem({ confidence: "high", updatedAt: NOW });
    const day10 = mem({ confidence: "high", updatedAt: "2026-06-20T00:00:00.000Z" });
    const day180 = mem({ confidence: "high", updatedAt: OLD });
    const now = base.updatedAt;
    const fresh = effectiveConfidence(base, now);
    const aged10 = effectiveConfidence(day10, now);
    const aged180 = effectiveConfidence(day180, now);
    expect(fresh).toBeGreaterThan(aged10);
    expect(aged10).toBeGreaterThan(aged180);
    expect(aged180).toBeGreaterThan(0); // never reaches zero — down-rank, not drop
  });

  it("does not exceed the fresh base weight for a not-yet-old memory", () => {
    const recentHigh = effectiveConfidence(mem({ confidence: "high", updatedAt: NOW }), NOW);
    expect(recentHigh).toBeLessThanOrEqual(1.1); // working boost ceiling
    expect(recentHigh).toBeGreaterThan(0.9);
  });

  it("ranks a recent high-confidence memory above an old low-confidence one", () => {
    const recentHigh = effectiveConfidence(mem({ confidence: "high", updatedAt: RECENT }), NOW);
    const oldLow = effectiveConfidence(mem({ confidence: "low", updatedAt: OLD }), NOW);
    expect(recentHigh).toBeGreaterThan(oldLow);
  });

  it("gives the working tier a small boost over recall at equal age/confidence", () => {
    const working = effectiveConfidence(
      mem({ confidence: "medium", updatedAt: RECENT, tier: "working" }),
      NOW,
    );
    const recall = effectiveConfidence(
      mem({ confidence: "medium", updatedAt: RECENT, tier: "recall" }),
      NOW,
    );
    expect(working).toBeGreaterThan(recall);
  });

  it("falls back to createdAt when updatedAt is older than createdAt is not the case — uses updatedAt", () => {
    // updatedAt drives age; createdAt is the fallback only when updatedAt absent.
    const m = mem({ confidence: "high", createdAt: OLD, updatedAt: RECENT });
    const byUpdated = effectiveConfidence(m, NOW);
    const old = effectiveConfidence(mem({ confidence: "high", updatedAt: OLD }), NOW);
    expect(byUpdated).toBeGreaterThan(old);
  });
});

describe("sweepMemoryTiers (deterministic archival planner, pinned now)", () => {
  const oldLow = (): MemoryEntry =>
    mem({ id: ID_A, confidence: "low", createdAt: OLD, updatedAt: OLD });
  const recentHigh = (): MemoryEntry =>
    mem({ id: ID_B, confidence: "high", createdAt: RECENT, updatedAt: RECENT });
  const closedSuperseded = (): MemoryEntry =>
    mem({
      id: ID_C,
      sessionId: SESSION_ID,
      scope: "session",
      confidence: "high",
      createdAt: RECENT,
      updatedAt: RECENT,
      validTo: "2026-06-01T00:00:00.000Z", // closed before NOW
    });

  it("archives an old low-confidence memory", () => {
    const { archiveIds } = sweepMemoryTiers([oldLow(), recentHigh()], NOW);
    expect(archiveIds).toContain(ID_A);
  });

  it("leaves a recent high-confidence memory untouched", () => {
    const { archiveIds } = sweepMemoryTiers([oldLow(), recentHigh()], NOW);
    expect(archiveIds).not.toContain(ID_B);
  });

  it("archives a closed/superseded memory regardless of confidence/age", () => {
    const { archiveIds } = sweepMemoryTiers([closedSuperseded()], NOW);
    expect(archiveIds).toContain(ID_C);
  });

  it("is idempotent — an already-archival memory is not re-archived", () => {
    const already = mem({
      id: ID_A,
      confidence: "low",
      createdAt: OLD,
      updatedAt: OLD,
      tier: "archival",
    });
    const { archiveIds } = sweepMemoryTiers([already, recentHigh()], NOW);
    expect(archiveIds).not.toContain(ID_A);
    expect(archiveIds).toEqual([]);
  });

  it("is deterministic for the same input and pinned now", () => {
    const input = [oldLow(), recentHigh(), closedSuperseded()];
    const a = sweepMemoryTiers(input, NOW);
    const b = sweepMemoryTiers(input, NOW);
    expect(a.archiveIds).toEqual(b.archiveIds);
  });
});

describe("RECALL-SAFETY: decay/tier never drop a current working/recall memory", () => {
  it("a current working memory stays recallable and is never an archive candidate", () => {
    const working = mem({ id: ID_A, confidence: "low", updatedAt: OLD, tier: "working" });
    // recallable: not filtered by tier (only archival is), still approved+current
    expect(isRecallable(working, NOW)).toBe(true);
    // decay only lowers its rank weight, never to zero
    expect(effectiveConfidence(working, NOW)).toBeGreaterThan(0);
    // working tier is never swept to archival even when old+low
    const { archiveIds } = sweepMemoryTiers([working], NOW);
    expect(archiveIds).not.toContain(ID_A);
  });

  it("a current recall memory is recallable even when heavily decayed", () => {
    const recall = mem({ id: ID_B, confidence: "low", updatedAt: OLD, tier: "recall" });
    expect(isRecallable(recall, NOW)).toBe(true);
    expect(effectiveConfidence(recall, NOW)).toBeGreaterThan(0);
  });
});

describe("malformed-now hardening (review)", () => {
  it("effectiveConfidence never returns NaN for a malformed now (degrades to no decay)", () => {
    const m = mem({ confidence: "high", updatedAt: RECENT });
    const v = effectiveConfidence(m, "not-a-date");
    expect(Number.isNaN(v)).toBe(false);
    expect(v).toBeGreaterThan(0);
  });

  it("sweepMemoryTiers throws on a malformed now instead of silently archiving nothing", () => {
    const oldLow = mem({ id: ID_A, confidence: "low", createdAt: OLD, updatedAt: OLD });
    // A NaN `at` makes every comparison false → silent no-op. Must fail loud.
    expect(() => sweepMemoryTiers([oldLow], "not-a-date")).toThrow();
  });
});
