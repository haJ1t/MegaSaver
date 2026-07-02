import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { searchMemoryEntriesSemantic } from "../src/memory-search-semantic.js";
import { searchMemoryEntries } from "../src/memory-search.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;
const NOW = "2026-06-30T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const RECENT = "2026-06-29T00:00:00.000Z";

const ID_RECENT_HIGH = "00000000-0000-4000-8000-0000000000d1";
const ID_OLD_LOW = "00000000-0000-4000-8000-0000000000d2";
const ID_ARCHIVAL = "00000000-0000-4000-8000-0000000000d3";

function entry(
  over: Omit<Partial<MemoryEntry>, "id"> & { id: string; content: string },
): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT,
    sessionId: null,
    scope: "project",
    type: over.type ?? "decision",
    title: over.title ?? over.content,
    content: over.content,
    keywords: over.keywords ?? [],
    confidence: over.confidence ?? "medium",
    source: over.source ?? "manual",
    approval: over.approval ?? "approved",
    stale: over.stale ?? false,
    createdAt: over.createdAt ?? RECENT,
    updatedAt: over.updatedAt ?? RECENT,
    ...(over.tier !== undefined ? { tier: over.tier } : {}),
  });
}

describe("searchMemoryEntries — M2 decay ranking", () => {
  it("ranks a recent high-confidence memory above an old low-confidence one at equal BM25", () => {
    // Same query terms in both ⇒ near-equal BM25; decay must break the tie.
    const recentHigh = entry({
      id: ID_RECENT_HIGH,
      content: "auth middleware decision",
      keywords: ["auth"],
      confidence: "high",
      updatedAt: RECENT,
    });
    const oldLow = entry({
      id: ID_OLD_LOW,
      content: "auth middleware decision",
      keywords: ["auth"],
      confidence: "low",
      updatedAt: OLD,
    });
    const result = searchMemoryEntries([oldLow, recentHigh], {
      text: "auth middleware",
      asOf: NOW,
    });
    expect(result.map((e) => e.id)).toEqual([ID_RECENT_HIGH, ID_OLD_LOW]);
  });

  it("never drops a current recall memory that has a BM25 hit (decay down-ranks only)", () => {
    const oldLow = entry({
      id: ID_OLD_LOW,
      content: "auth middleware decision",
      keywords: ["auth"],
      confidence: "low",
      updatedAt: OLD,
    });
    const result = searchMemoryEntries([oldLow], { text: "auth middleware", asOf: NOW });
    expect(result.map((e) => e.id)).toContain(ID_OLD_LOW);
  });

  it("excludes archival by default, includes it with includeArchival", () => {
    const recall = entry({ id: ID_RECENT_HIGH, content: "alpha decision" });
    const archival = entry({ id: ID_ARCHIVAL, content: "beta decision", tier: "archival" });
    const def = searchMemoryEntries([recall, archival], { asOf: NOW });
    expect(def.map((e) => e.id)).toContain(ID_RECENT_HIGH);
    expect(def.map((e) => e.id)).not.toContain(ID_ARCHIVAL);

    const incl = searchMemoryEntries([recall, archival], { asOf: NOW, includeArchival: true });
    expect(incl.map((e) => e.id).sort()).toEqual([ID_RECENT_HIGH, ID_ARCHIVAL].sort());
  });
});

describe("searchMemoryEntriesSemantic — M2 archival filter", () => {
  const v = (id: string) => Float32Array.from([1, 0]);

  it("excludes archival by default, includes it with includeArchival", () => {
    const recall = entry({ id: ID_RECENT_HIGH, content: "alpha" });
    const archival = entry({ id: ID_ARCHIVAL, content: "beta", tier: "archival" });
    const memoryVectors = new Map<string, Float32Array>([
      [ID_RECENT_HIGH, v(ID_RECENT_HIGH)],
      [ID_ARCHIVAL, v(ID_ARCHIVAL)],
    ]);
    const queryVector = Float32Array.from([1, 0]);

    const def = searchMemoryEntriesSemantic([recall, archival], {
      queryVector,
      memoryVectors,
      asOf: NOW,
    });
    expect(def.map((e) => e.id)).toEqual([ID_RECENT_HIGH]);

    const incl = searchMemoryEntriesSemantic([recall, archival], {
      queryVector,
      memoryVectors,
      asOf: NOW,
      includeArchival: true,
    });
    expect(incl.map((e) => e.id).sort()).toEqual([ID_RECENT_HIGH, ID_ARCHIVAL].sort());
  });
});
