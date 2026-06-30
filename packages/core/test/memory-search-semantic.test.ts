import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { searchMemoryEntriesSemantic } from "../src/memory-search-semantic.js";
import { searchMemoryEntries } from "../src/memory-search.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;

function entry(over: Partial<MemoryEntry> & { id: string; content: string }): MemoryEntry {
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
    createdAt: over.createdAt ?? "2026-06-11T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-06-11T00:00:00.000Z",
    ...(over.validFrom !== undefined ? { validFrom: over.validFrom } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
  });
}

const NEAR = "00000000-0000-4000-8000-0000000000a1";
const FAR = "00000000-0000-4000-8000-0000000000a2";

describe("searchMemoryEntriesSemantic — injected vectors", () => {
  it("ranks a cosine-near memory above a BM25-equal far one", () => {
    // Two memories with IDENTICAL lexical text so BM25 would tie. Only the
    // injected vectors differ — semantic ranking must separate them.
    const near = entry({ id: NEAR, content: "handler data io", title: "handler" });
    const far = entry({ id: FAR, content: "handler data io", title: "handler" });

    const queryVector = Float32Array.from([1, 0, 0]);
    const memoryVectors = new Map<string, Float32Array>([
      [NEAR, Float32Array.from([0.9, 0.1, 0])],
      [FAR, Float32Array.from([0, 0, 1])],
    ]);

    const result = searchMemoryEntriesSemantic([near, far], {
      queryVector,
      memoryVectors,
    });
    expect(result[0]?.id).toBe(NEAR);
    expect(result.map((m) => m.id)).toEqual([NEAR, FAR]);
  });

  it("honors field filters (approval/stale/type) before semantic ranking", () => {
    const approved = entry({ id: NEAR, content: "x", approval: "approved" });
    const suggested = entry({ id: FAR, content: "x", approval: "suggested" });
    const queryVector = Float32Array.from([1, 0]);
    const memoryVectors = new Map<string, Float32Array>([
      [NEAR, Float32Array.from([1, 0])],
      [FAR, Float32Array.from([1, 0])],
    ]);
    const ids = searchMemoryEntriesSemantic([approved, suggested], {
      queryVector,
      memoryVectors,
    }).map((m) => m.id);
    expect(ids).toEqual([NEAR]);
  });

  it("drops a memory with no vector in the sidecar (cannot rank it)", () => {
    const withVec = entry({ id: NEAR, content: "x" });
    const noVec = entry({ id: FAR, content: "x" });
    const result = searchMemoryEntriesSemantic([withVec, noVec], {
      queryVector: Float32Array.from([1, 0]),
      memoryVectors: new Map([[NEAR, Float32Array.from([1, 0])]]),
    });
    expect(result.map((m) => m.id)).toEqual([NEAR]);
  });

  it("honors limit", () => {
    const a = entry({ id: NEAR, content: "x" });
    const b = entry({ id: FAR, content: "x" });
    const result = searchMemoryEntriesSemantic([a, b], {
      queryVector: Float32Array.from([1, 0]),
      memoryVectors: new Map([
        [NEAR, Float32Array.from([1, 0])],
        [FAR, Float32Array.from([0.5, 0.5])],
      ]),
      limit: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(NEAR);
  });

  it("empty sidecar yields no semantic hits (boundary falls back to BM25)", () => {
    const a = entry({ id: NEAR, content: "auth middleware" });
    expect(
      searchMemoryEntriesSemantic([a], {
        queryVector: Float32Array.from([1, 0]),
        memoryVectors: new Map(),
      }),
    ).toEqual([]);
    // BM25 still works as the fallback the boundary would use.
    expect(searchMemoryEntries([a], { text: "auth" }).map((m) => m.id)).toEqual([NEAR]);
  });

  it("filters to currently-valid memories by default and time-travels with asOf", () => {
    const closed = entry({
      id: NEAR,
      content: "x",
      validFrom: "2026-06-01T00:00:00.000Z",
      validTo: "2026-06-20T00:00:00.000Z",
    });
    const queryVector = Float32Array.from([1, 0]);
    const memoryVectors = new Map([[NEAR, Float32Array.from([1, 0])]]);

    // Default (now) — closed memory is no longer current, dropped.
    expect(
      searchMemoryEntriesSemantic([closed], { queryVector, memoryVectors }).map((m) => m.id),
    ).toEqual([]);

    // asOf inside the closed window — historical recall returns it.
    expect(
      searchMemoryEntriesSemantic([closed], {
        queryVector,
        memoryVectors,
        asOf: "2026-06-10T00:00:00.000Z",
      }).map((m) => m.id),
    ).toEqual([NEAR]);
  });
});
