import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
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
    stale: over.stale ?? false,
    createdAt: over.createdAt ?? "2026-06-11T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-06-11T00:00:00.000Z",
  });
}

describe("searchMemoryEntries", () => {
  it("ranks by BM25 over title+content+keywords for a text query", () => {
    const entries = [
      entry({
        id: "00000000-0000-4000-8000-0000000000a1",
        content: "use JWT auth middleware for protected routes",
        keywords: ["auth", "jwt"],
      }),
      entry({ id: "00000000-0000-4000-8000-0000000000a2", content: "navbar uses a sticky header" }),
    ];
    const result = searchMemoryEntries(entries, { text: "auth middleware" });
    expect(result[0]?.id).toBe("00000000-0000-4000-8000-0000000000a1");
    expect(result.map((e) => e.id)).not.toContain("00000000-0000-4000-8000-0000000000a2");
  });

  it("excludes stale entries by default, includes them when asked", () => {
    const fresh = entry({ id: "00000000-0000-4000-8000-0000000000b1", content: "fresh decision" });
    const stale = entry({
      id: "00000000-0000-4000-8000-0000000000b2",
      content: "stale decision",
      stale: true,
    });
    expect(searchMemoryEntries([fresh, stale], {}).map((e) => e.id)).toEqual([
      "00000000-0000-4000-8000-0000000000b1",
    ]);
    expect(
      searchMemoryEntries([fresh, stale], { includeStale: true })
        .map((e) => e.id)
        .sort(),
    ).toEqual(["00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b2"]);
  });

  it("filters by type and confidence before ranking", () => {
    const a = entry({
      id: "00000000-0000-4000-8000-0000000000c1",
      content: "x",
      type: "bug",
      confidence: "high",
    });
    const b = entry({
      id: "00000000-0000-4000-8000-0000000000c2",
      content: "x",
      type: "decision",
      confidence: "low",
    });
    expect(searchMemoryEntries([a, b], { type: "bug" }).map((e) => e.id)).toEqual([
      "00000000-0000-4000-8000-0000000000c1",
    ]);
    expect(searchMemoryEntries([a, b], { confidence: "low" }).map((e) => e.id)).toEqual([
      "00000000-0000-4000-8000-0000000000c2",
    ]);
  });

  it("returns an empty array for an empty corpus (with and without text)", () => {
    expect(searchMemoryEntries([], { text: "anything" })).toEqual([]);
    expect(searchMemoryEntries([], {})).toEqual([]);
  });

  it("with no text returns newest-first and honors limit", () => {
    const older = entry({
      id: "00000000-0000-4000-8000-0000000000d1",
      content: "older",
      createdAt: "2026-06-10T00:00:00.000Z",
    });
    const newer = entry({
      id: "00000000-0000-4000-8000-0000000000d2",
      content: "newer",
      createdAt: "2026-06-11T00:00:00.000Z",
    });
    expect(searchMemoryEntries([older, newer], {}).map((e) => e.id)).toEqual([
      "00000000-0000-4000-8000-0000000000d2",
      "00000000-0000-4000-8000-0000000000d1",
    ]);
    expect(searchMemoryEntries([older, newer], { limit: 1 }).map((e) => e.id)).toEqual([
      "00000000-0000-4000-8000-0000000000d2",
    ]);
  });
});
