import type { MemoryEntryId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import { buildLineage, changedFromFor } from "../src/supersession.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ID_A = "00000000-0000-4000-8000-0000000000f1" as MemoryEntryId;
const ID_B = "00000000-0000-4000-8000-0000000000f2" as MemoryEntryId;
const ID_C = "00000000-0000-4000-8000-0000000000f3" as MemoryEntryId;
const ID_X = "00000000-0000-4000-8000-0000000000f4" as MemoryEntryId;
const ID_MISSING = "00000000-0000-4000-8000-0000000000ff" as MemoryEntryId;
const CLOSED_AT = "2026-07-10T00:00:00.000Z";

const mk = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
  ({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: `title ${id.slice(-2)}`,
    content: `content ${id.slice(-2)}`,
    keywords: [],
    confidence: "medium",
    source: "agent",
    approval: "approved",
    stale: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }) as MemoryEntry;

describe("buildLineage", () => {
  const a = mk(ID_A, { validTo: CLOSED_AT });
  const b = mk(ID_B, {
    supersedesId: ID_A,
    createdAt: "2026-07-02T00:00:00.000Z",
    validTo: CLOSED_AT,
  });
  const c = mk(ID_C, { supersedesId: ID_B, createdAt: "2026-07-03T00:00:00.000Z" });

  it("chain of 3, from the middle: oldest -> newest", () => {
    expect(buildLineage([c, a, b], ID_B).map((e) => e.id)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("chain of 3, from the oldest and the newest: same chain", () => {
    expect(buildLineage([c, a, b], ID_A).map((e) => e.id)).toEqual([ID_A, ID_B, ID_C]);
    expect(buildLineage([c, a, b], ID_C).map((e) => e.id)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("terminates on a forged supersedesId cycle", () => {
    const cycleA = mk(ID_A, { supersedesId: ID_B });
    const cycleB = mk(ID_B, { supersedesId: ID_A });
    expect(buildLineage([cycleA, cycleB], ID_A).map((e) => e.id)).toEqual([ID_B, ID_A]);
  });

  it("picks the FIRST child per parent by createdAt asc", () => {
    const parent = mk(ID_A);
    const firstChild = mk(ID_B, { supersedesId: ID_A, createdAt: "2026-07-02T00:00:00.000Z" });
    const laterChild = mk(ID_X, { supersedesId: ID_A, createdAt: "2026-07-05T00:00:00.000Z" });
    expect(buildLineage([laterChild, parent, firstChild], ID_A).map((e) => e.id)).toEqual([
      ID_A,
      ID_B,
    ]);
  });

  it("unknown id -> empty chain", () => {
    expect(buildLineage([a, b], ID_MISSING)).toEqual([]);
  });
});

describe("changedFromFor", () => {
  const byIdOf = (entries: MemoryEntry[]): ReadonlyMap<string, MemoryEntry> =>
    new Map<string, MemoryEntry>(entries.map((e) => [e.id, e]));

  it("closed predecessor -> title + closedAt, hit reason wins", () => {
    const predecessor = mk(ID_A, { validTo: CLOSED_AT, reason: "old reason" });
    const cf = changedFromFor(
      { supersedesId: ID_A, reason: "newer decision" },
      byIdOf([predecessor]),
    );
    expect(cf).toEqual({
      title: predecessor.title,
      closedAt: CLOSED_AT,
      reason: "newer decision",
    });
  });

  it("hit reason absent -> falls back to the predecessor reason", () => {
    const predecessor = mk(ID_A, { validTo: CLOSED_AT, reason: "old reason" });
    const cf = changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]));
    expect(cf).toEqual({ title: predecessor.title, closedAt: CLOSED_AT, reason: "old reason" });
  });

  it("both reasons absent -> no reason key at all", () => {
    const predecessor = mk(ID_A, { validTo: CLOSED_AT });
    const cf = changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]));
    expect(cf).toBeDefined();
    expect(cf !== undefined && "reason" in cf).toBe(false);
  });

  it("reopened predecessor (validTo null) -> undefined", () => {
    const predecessor = mk(ID_A, { validTo: null });
    expect(changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]))).toBeUndefined();
  });

  it("never-closed predecessor (validTo absent) -> undefined", () => {
    const predecessor = mk(ID_A);
    expect(changedFromFor({ supersedesId: ID_A }, byIdOf([predecessor]))).toBeUndefined();
  });

  it("missing predecessor -> undefined", () => {
    expect(changedFromFor({ supersedesId: ID_MISSING }, byIdOf([]))).toBeUndefined();
  });

  it("hit without supersedesId -> undefined", () => {
    expect(changedFromFor({}, byIdOf([mk(ID_A, { validTo: CLOSED_AT })]))).toBeUndefined();
  });
});
