import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { POSSIBLE_SUPERSEDES_PREFIX, saveMemoryWithLineage } from "../src/index.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const ID_OLD = "00000000-0000-4000-8000-0000000000a1" as MemoryEntryId;
const ID_NEW = "00000000-0000-4000-8000-0000000000a2" as MemoryEntryId;
const ID_THIRD = "00000000-0000-4000-8000-0000000000a3" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-13T12:00:00.000Z";
const now = () => NOW;

function mem(
  over: Omit<Partial<MemoryEntry>, "id"> & { id: string; content: string },
): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: over.type ?? "decision",
    title: over.title ?? over.content,
    content: over.content,
    keywords: over.keywords ?? [],
    confidence: "medium",
    source: over.source ?? "agent",
    approval: over.approval ?? "approved",
    stale: false,
    createdAt: over.createdAt ?? TS,
    updatedAt: over.updatedAt ?? TS,
    ...(over.relatedFiles !== undefined ? { relatedFiles: over.relatedFiles } : {}),
    ...(over.supersedesId !== undefined ? { supersedesId: over.supersedesId } : {}),
    ...(over.evidence !== undefined ? { evidence: over.evidence } : {}),
  });
}

function freshRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("saveMemoryWithLineage — close ladder", () => {
  it("suggested write with detected supersession: link carried, NO close", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({ id: ID_OLD, content: "use npm for installs", relatedFiles: ["package.json"] }),
    );
    const candidate = mem({
      id: ID_NEW,
      content: "use pnpm for installs",
      relatedFiles: ["package.json"],
      approval: "suggested",
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "supersession",
      closed: false,
    });
    expect(result.deduped).toBeUndefined();
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("born-approved + weak lexical class: DOWNGRADED to note-only (no link, no close)", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({ id: ID_OLD, content: "use npm for installs", relatedFiles: ["package.json"] }),
    );
    const candidate = mem({
      id: ID_NEW,
      content: "use pnpm for installs",
      relatedFiles: ["package.json"],
      evidence: ["seed"],
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.supersession).toBeUndefined();
    expect(result.entry.supersedesId).toBeUndefined();
    expect(result.entry.evidence).toEqual(["seed", `${POSSIBLE_SUPERSEDES_PREFIX}${ID_OLD}`]);
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("born-approved + contradiction: link + immediate close", () => {
    const registry = freshRegistry();
    // Same-type corpus (eligibleSupersessionCorpus filters same type), so the
    // lexical contradiction class only fires on an equal-content polarity
    // flip: different content in same type + file overlap classifies as the
    // weak "supersession" class first (checkConflicts precedence).
    registry.createMemoryEntry(
      mem({
        id: ID_OLD,
        type: "project_rule",
        title: "merge gate",
        content: "tests must pass before merge",
        keywords: ["merge", "pass"],
        relatedFiles: ["ci.yml"],
      }),
    );
    const candidate = mem({
      id: ID_NEW,
      type: "project_rule",
      title: "merge gate override",
      content: "tests must pass before merge",
      keywords: ["merge", "skip"],
      relatedFiles: ["ci.yml"],
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "contradiction",
      closed: true,
    });
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBe(NOW);
  });

  it("born-approved + cosine >= 0.80: link + immediate close with score", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({
        id: ID_OLD,
        title: "auth middleware decision",
        content: "auth middleware uses jwt tokens",
      }),
    );
    const candidate = mem({
      id: ID_NEW,
      title: "auth middleware decision v2",
      content: "auth middleware uses session cookies",
    });

    const result = saveMemoryWithLineage(registry, candidate, {
      now,
      queryVector: Float32Array.from([1, 0]),
      memoryVectors: new Map<string, Float32Array>([[ID_OLD, Float32Array.from([1, 0])]]),
    });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "cosine",
      score: 1,
      closed: true,
    });
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBe(NOW);
  });

  it("cosine ambiguous band: evidence note appended, no link, no close", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(
      mem({
        id: ID_OLD,
        title: "auth middleware decision",
        content: "auth middleware uses jwt tokens",
      }),
    );
    const candidate = mem({
      id: ID_NEW,
      title: "auth middleware decision v2",
      content: "auth middleware uses session cookies",
      evidence: ["seed"],
    });

    const result = saveMemoryWithLineage(registry, candidate, {
      now,
      queryVector: Float32Array.from([1, 0]),
      memoryVectors: new Map<string, Float32Array>([[ID_OLD, Float32Array.from([1, 1])]]),
    });

    expect(result.supersession).toBeUndefined();
    expect(result.entry.supersedesId).toBeUndefined();
    expect(result.entry.evidence).toEqual(["seed", `${POSSIBLE_SUPERSEDES_PREFIX}${ID_OLD}`]);
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("explicit supersedesId beats detection (a duplicate that would dedupe is still written)", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_OLD, content: "use npm for installs" }));
    registry.createMemoryEntry(mem({ id: ID_THIRD, content: "exact duplicate content" }));
    const candidate = mem({
      id: ID_NEW,
      content: "exact duplicate content",
      supersedesId: ID_OLD,
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.id).toBe(ID_NEW);
    expect(result.deduped).toBeUndefined();
    expect(result.supersession).toEqual({
      supersededId: ID_OLD,
      via: "explicit",
      closed: true,
    });
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBe(NOW);
    expect(registry.getMemoryEntry(ID_THIRD)?.validTo).toBeUndefined();
  });

  it("explicit supersedesId on a suggested write: passthrough, no close, no supersession field", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_OLD, content: "use npm for installs" }));
    const candidate = mem({
      id: ID_NEW,
      content: "use pnpm for installs",
      approval: "suggested",
      supersedesId: ID_OLD,
    });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.supersedesId).toBe(ID_OLD);
    expect(result.supersession).toBeUndefined();
    expect(registry.getMemoryEntry(ID_OLD)?.validTo).toBeUndefined();
  });

  it("detect: false -> plain create even when an exact duplicate exists", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_THIRD, content: "exact duplicate content" }));
    const candidate = mem({ id: ID_NEW, content: "exact duplicate content" });

    const result = saveMemoryWithLineage(registry, candidate, { now, detect: false });

    expect(result.entry.id).toBe(ID_NEW);
    expect(result.deduped).toBeUndefined();
    expect(result.supersession).toBeUndefined();
    expect(registry.listMemoryEntries(candidate.projectId)).toHaveLength(2);
  });

  it("duplicate short-circuits: NO write, returns the existing row", () => {
    const registry = freshRegistry();
    registry.createMemoryEntry(mem({ id: ID_THIRD, content: "exact duplicate content" }));
    const candidate = mem({ id: ID_NEW, content: "exact duplicate content" });

    const result = saveMemoryWithLineage(registry, candidate, { now });

    expect(result.entry.id).toBe(ID_THIRD);
    expect(result.deduped).toEqual({ existingId: ID_THIRD });
    expect(result.supersession).toBeUndefined();
    expect(registry.getMemoryEntry(ID_NEW)).toBeNull();
    expect(registry.listMemoryEntries(candidate.projectId)).toHaveLength(1);
  });

  it("detection throw -> fail-open plain create", () => {
    const registry = freshRegistry();
    const throwing: CoreRegistry = {
      ...registry,
      listMemoryEntries: () => {
        throw new Error("boom");
      },
    };
    const candidate = mem({ id: ID_NEW, content: "auth uses JWT" });

    const result = saveMemoryWithLineage(throwing, candidate, { now });

    expect(result.entry.id).toBe(ID_NEW);
    expect(result.supersession).toBeUndefined();
    expect(result.deduped).toBeUndefined();
    expect(registry.getMemoryEntry(ID_NEW)).not.toBeNull();
  });
});
