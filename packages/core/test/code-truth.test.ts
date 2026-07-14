import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type ExtractedBlockLite, type RepoState, verifyAnchors } from "../src/code-truth.js";
import type { CodeAnchor } from "../src/memory-anchor.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const E1 = "00000000-0000-4000-8000-0000000000b1" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";
const EARLIER = "2026-07-10T00:00:00.000Z";
const OLD_HEAD = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const FALSIFIER = "3333333333333333333333333333333333333333";

function anchor(over?: Partial<CodeAnchor>): CodeAnchor {
  return { repoHead: OLD_HEAD, capturedAt: TS, files: [], symbols: [], ...over };
}

function mem(over: Omit<Partial<MemoryEntry>, "id"> & { id: string }): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "auth verifies via verifyToken",
    content: "auth middleware validates requests via verifyToken",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: over.stale ?? false,
    createdAt: TS,
    updatedAt: TS,
    ...(over.anchor !== undefined ? { anchor: over.anchor } : {}),
    ...(over.lastVerified !== undefined ? { lastVerified: over.lastVerified } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
  });
}

function repo(over?: Partial<RepoState>): RepoState {
  return {
    headSha: HEAD,
    blobs: new Map(),
    blocks: new Map(),
    renames: new Map(),
    attribution: new Map(),
    ...over,
  };
}

const FILE_ANCHOR = anchor({ files: [{ path: "src/a.ts", blobSha: "blob-old" }] });
const SYMBOL_ANCHOR = anchor({
  symbols: [
    { path: "src/a.ts", name: "verifyToken", startLine: 1, endLine: 3, contentHash: "hash-old" },
  ],
});

const block = (over?: Partial<ExtractedBlockLite>): ExtractedBlockLite => ({
  name: "verifyToken",
  contentHash: "hash-old",
  startLine: 1,
  endLine: 3,
  ...over,
});

describe("verifyAnchors — contradiction ladder", () => {
  it("entry without anchor -> unanchored", () => {
    const plan = verifyAnchors([mem({ id: E1 })], repo(), NOW);
    expect(plan.unanchored).toEqual([E1]);
    expect(plan.verified).toEqual([]);
    expect(plan.contradicted).toEqual([]);
  });

  it("blob change alone stays verified — file anchors are weak claims", () => {
    const entries = [mem({ id: E1, anchor: FILE_ANCHOR })];
    const plan = verifyAnchors(entries, repo({ blobs: new Map([["src/a.ts", "blob-NEW"]]) }), NOW);
    expect(plan.verified).toEqual([E1]);
    expect(plan.contradicted).toEqual([]);
  });

  it("file deleted without rename -> contradicted with commit attribution", () => {
    const entries = [mem({ id: E1, anchor: FILE_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blobs: new Map([["src/a.ts", "missing"]]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([{ id: E1, reason: "src/a.ts deleted", commit: FALSIFIER }]);
  });

  it("file deleted WITH rename -> repointed + verified, never contradicted", () => {
    const entries = [mem({ id: E1, anchor: FILE_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blobs: new Map([
          ["src/a.ts", "missing"],
          ["src/b.ts", "blob-whatever"],
        ]),
        renames: new Map([["src/a.ts", "src/b.ts"]]),
      }),
      NOW,
    );
    expect(plan.repointed).toEqual([{ id: E1, from: "src/a.ts", to: "src/b.ts" }]);
    expect(plan.verified).toEqual([E1]);
    expect(plan.contradicted).toEqual([]);
  });

  it("symbol missing -> contradicted", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([["src/a.ts", [block({ name: "parseToken" })]]]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken missing", commit: FALSIFIER },
    ]);
  });

  it("symbol hash changed -> contradicted", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([["src/a.ts", [block({ contentHash: "hash-NEW" })]]]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken hash changed", commit: FALSIFIER },
    ]);
  });

  it("name collision: ANY candidate matching the hash verifies", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([
          ["src/a.ts", [block({ contentHash: "hash-NEW" }), block({ startLine: 10, endLine: 12 })]],
        ]),
      }),
      NOW,
    );
    expect(plan.verified).toEqual([E1]);
    expect(plan.contradicted).toEqual([]);
  });

  it("name collision: NO candidate matching the hash contradicts", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({
        blocks: new Map([
          [
            "src/a.ts",
            [
              block({ contentHash: "hash-NEW" }),
              block({ contentHash: "hash-OTHER", startLine: 10, endLine: 12 }),
            ],
          ],
        ]),
        attribution: new Map([["src/a.ts", FALSIFIER]]),
      }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken hash changed", commit: FALSIFIER },
    ]);
  });

  it("dirty tree: no attribution -> commit absent, reason says uncommitted change", () => {
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR })];
    const plan = verifyAnchors(
      entries,
      repo({ blocks: new Map([["src/a.ts", [block({ contentHash: "hash-NEW" })]]]) }),
      NOW,
    );
    expect(plan.contradicted).toEqual([
      { id: E1, reason: "src/a.ts#verifyToken hash changed (uncommitted change)" },
    ]);
  });

  it("rename re-checks the symbol under the NEW path in the same pass", () => {
    const entries = [
      mem({
        id: E1,
        anchor: anchor({
          files: [{ path: "src/a.ts", blobSha: "blob-old" }],
          symbols: [
            {
              path: "src/a.ts",
              name: "verifyToken",
              startLine: 1,
              endLine: 3,
              contentHash: "hash-old",
            },
          ],
        }),
      }),
    ];
    const plan = verifyAnchors(
      entries,
      repo({
        blobs: new Map([
          ["src/a.ts", "missing"],
          ["src/b.ts", "blob-new"],
        ]),
        renames: new Map([["src/a.ts", "src/b.ts"]]),
        blocks: new Map([["src/b.ts", [block()]]]),
      }),
      NOW,
    );
    expect(plan.repointed).toEqual([{ id: E1, from: "src/a.ts", to: "src/b.ts" }]);
    expect(plan.verified).toEqual([E1]);
  });
});

describe("verifyAnchors — heal keyed strictly on lastVerified (B1 plan level)", () => {
  const PASSING = repo({
    blobs: new Map([["src/a.ts", "blob-old"]]),
    blocks: new Map([["src/a.ts", [block()]]]),
  });

  it("lastVerified contradicted + checks pass -> healed", () => {
    const entries = [
      mem({
        id: E1,
        anchor: SYMBOL_ANCHOR,
        lastVerified: {
          headSha: OLD_HEAD,
          at: TS,
          result: "contradicted",
          closedByCodeTruth: true,
        },
      }),
    ];
    const plan = verifyAnchors(entries, PASSING, NOW);
    expect(plan.healed).toEqual([E1]);
    expect(plan.verified).toEqual([]);
  });

  it("row closed by lineage WITHOUT lastVerified stays verified — never healed", () => {
    // B1 regression, plan level: supersession closed validTo; there is no
    // structured contradiction record, so the planner must not emit a heal
    // (evidence-string sniffing is exactly what B1 forbids).
    const entries = [mem({ id: E1, anchor: SYMBOL_ANCHOR, validTo: EARLIER })];
    const plan = verifyAnchors(entries, PASSING, NOW);
    expect(plan.verified).toEqual([E1]);
    expect(plan.healed).toEqual([]);
  });

  it("lastVerified verified + checks pass -> verified, not healed", () => {
    const entries = [
      mem({
        id: E1,
        anchor: SYMBOL_ANCHOR,
        lastVerified: { headSha: OLD_HEAD, at: TS, result: "verified", closedByCodeTruth: false },
      }),
    ];
    const plan = verifyAnchors(entries, PASSING, NOW);
    expect(plan.verified).toEqual([E1]);
    expect(plan.healed).toEqual([]);
  });

  it("still-failing contradicted row -> contradicted again, not healed", () => {
    const entries = [
      mem({
        id: E1,
        anchor: SYMBOL_ANCHOR,
        lastVerified: {
          headSha: OLD_HEAD,
          at: TS,
          result: "contradicted",
          closedByCodeTruth: true,
        },
      }),
    ];
    const plan = verifyAnchors(
      entries,
      repo({ blocks: new Map([["src/a.ts", [block({ contentHash: "hash-NEW" })]]]) }),
      NOW,
    );
    expect(plan.contradicted).toHaveLength(1);
    expect(plan.healed).toEqual([]);
  });
});
