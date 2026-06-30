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
    approval: over.approval ?? "approved",
    stale: over.stale ?? false,
    createdAt: over.createdAt ?? "2026-06-11T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-06-11T00:00:00.000Z",
    ...(over.validFrom !== undefined ? { validFrom: over.validFrom } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
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

  it("excludes suggested and rejected by default", () => {
    const entries = [
      entry({ id: "00000000-0000-4000-8000-0000000000e1", approval: "approved", content: "alpha" }),
      entry({
        id: "00000000-0000-4000-8000-0000000000e2",
        approval: "suggested",
        content: "alpha",
      }),
      entry({ id: "00000000-0000-4000-8000-0000000000e3", approval: "rejected", content: "alpha" }),
    ];
    const ids = searchMemoryEntries(entries, { text: "alpha" }).map((e) => e.id);
    expect(ids).toEqual(["00000000-0000-4000-8000-0000000000e1"]);
  });

  it("includes unapproved when includeUnapproved is set", () => {
    const entries = [
      entry({ id: "00000000-0000-4000-8000-0000000000f1", approval: "approved", content: "alpha" }),
      entry({
        id: "00000000-0000-4000-8000-0000000000f2",
        approval: "suggested",
        content: "alpha",
      }),
    ];
    const ids = searchMemoryEntries(entries, { text: "alpha", includeUnapproved: true })
      .map((e) => e.id)
      .sort();
    expect(ids).toEqual([
      "00000000-0000-4000-8000-0000000000f1",
      "00000000-0000-4000-8000-0000000000f2",
    ]);
  });

  it("approval and stale gates are independent", () => {
    const entries = [
      entry({
        id: "00000000-0000-4000-8000-000000000071",
        approval: "suggested",
        stale: true,
        content: "alpha",
      }),
    ];
    expect(searchMemoryEntries(entries, { text: "alpha", includeStale: true })).toHaveLength(0);
    expect(
      searchMemoryEntries(entries, { text: "alpha", includeStale: true, includeUnapproved: true }),
    ).toHaveLength(1);
  });
});

describe("searchMemoryEntries bi-temporal (asOf)", () => {
  // A superseded fact: valid June 1 → June 20, then closed.
  const closed = entry({
    id: "00000000-0000-4000-8000-0000000000c1",
    content: "deploy region us-east",
    validFrom: "2026-06-01T00:00:00.000Z",
    validTo: "2026-06-20T00:00:00.000Z",
  });
  // The superseding fact: valid from June 20, still open.
  const current = entry({
    id: "00000000-0000-4000-8000-0000000000c2",
    content: "deploy region eu-west",
    validFrom: "2026-06-20T00:00:00.000Z",
  });

  it("recall as of an instant after the close returns only the currently-valid memory", () => {
    // Pin asOf explicitly (a moment after the close) so the assertion does not
    // depend on the wall clock — with a bare {} default-now this would have
    // failed in CI before 2026-06-20 (the close date).
    const ids = searchMemoryEntries([closed, current], {
      asOf: "2026-06-25T00:00:00.000Z",
    }).map((e) => e.id);
    expect(ids).toEqual(["00000000-0000-4000-8000-0000000000c2"]);
  });

  it("default (now) recall excludes a long-closed memory", () => {
    // The `closed` fixture's validTo is in the past relative to any real now, so
    // default-now recall must never return it — clock-independent in that
    // direction. (`current` has a future-safe open window: validFrom past, no
    // validTo.)
    const openNow = entry({
      id: "00000000-0000-4000-8000-0000000000c4",
      content: "always open",
      validFrom: "2026-06-01T00:00:00.000Z",
    });
    const ids = searchMemoryEntries([closed, openNow], {}).map((e) => e.id);
    expect(ids).toEqual(["00000000-0000-4000-8000-0000000000c4"]);
  });

  it("asOf during the closed window returns the historical (then-current) memory", () => {
    const ids = searchMemoryEntries([closed, current], {
      asOf: "2026-06-10T00:00:00.000Z",
    }).map((e) => e.id);
    expect(ids).toEqual(["00000000-0000-4000-8000-0000000000c1"]);
  });

  it("rows without temporal bounds are treated as current (back-compat)", () => {
    const legacy = entry({
      id: "00000000-0000-4000-8000-0000000000c3",
      content: "no bounds memory",
    });
    const ids = searchMemoryEntries([legacy], {}).map((e) => e.id);
    expect(ids).toEqual(["00000000-0000-4000-8000-0000000000c3"]);
  });
});
