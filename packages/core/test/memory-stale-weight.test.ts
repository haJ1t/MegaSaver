import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  type MemoryEntry,
  STALE_WEIGHT,
  effectiveConfidence,
  memoryEntrySchema,
} from "../src/memory-entry.js";
import { searchMemoryEntries } from "../src/memory-search.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;
const NOW = "2026-07-13T00:00:00.000Z";
// exactly one 30-day half-life before NOW
const THIRTY_DAYS_AGO = "2026-06-13T00:00:00.000Z";

function entry(
  over: Omit<Partial<MemoryEntry>, "id"> & { id: string; content: string },
): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: over.title ?? over.content,
    content: over.content,
    keywords: over.keywords ?? [],
    confidence: over.confidence ?? "medium",
    source: "manual",
    approval: "approved",
    stale: over.stale ?? false,
    createdAt: over.createdAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW,
    ...(over.lastActiveAt !== undefined ? { lastActiveAt: over.lastActiveAt } : {}),
  });
}

describe("STALE_WEIGHT", () => {
  it("is 0.3", () => {
    expect(STALE_WEIGHT).toBe(0.3);
  });

  it("a stale row scores exactly STALE_WEIGHT x its non-stale twin", () => {
    const fresh = entry({ id: "00000000-0000-4000-8000-0000000000a1", content: "auth uses jwt" });
    const stale = entry({
      id: "00000000-0000-4000-8000-0000000000a2",
      content: "auth uses jwt",
      stale: true,
    });
    expect(effectiveConfidence(stale, NOW)).toBe(effectiveConfidence(fresh, NOW) * STALE_WEIGHT);
    expect(effectiveConfidence(stale, NOW)).toBeLessThan(effectiveConfidence(fresh, NOW));
  });

  it("non-stale rows keep the exact pre-change values (bit-identical)", () => {
    // medium (0.67) x zero-age decay (1) x default recall tier (1)
    const zeroAge = entry({
      id: "00000000-0000-4000-8000-0000000000b1",
      content: "x",
      lastActiveAt: NOW,
    });
    expect(effectiveConfidence(zeroAge, NOW)).toBe(0.67);
    // medium (0.67) x exactly one half-life (0.5) x recall (1)
    const halfLife = entry({
      id: "00000000-0000-4000-8000-0000000000b2",
      content: "x",
      createdAt: THIRTY_DAYS_AGO,
      updatedAt: THIRTY_DAYS_AGO,
      lastActiveAt: THIRTY_DAYS_AGO,
    });
    expect(effectiveConfidence(halfLife, NOW)).toBe(0.67 * 0.5);
  });

  it("includeStale search ranks the stale twin below the non-stale row", () => {
    const fresh = entry({
      id: "00000000-0000-4000-8000-0000000000c1",
      content: "redis cache invalidation strategy",
    });
    const stale = entry({
      id: "00000000-0000-4000-8000-0000000000c2",
      content: "redis cache invalidation strategy",
      stale: true,
    });
    const result = searchMemoryEntries([stale, fresh], {
      text: "redis cache invalidation",
      includeStale: true,
      asOf: NOW,
    });
    expect(result.map((e) => e.id)).toEqual([fresh.id, stale.id]);
  });
});
