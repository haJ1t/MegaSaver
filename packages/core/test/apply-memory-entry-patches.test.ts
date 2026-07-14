import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import {
  type MemoryEntry,
  type MemoryEntryUpdatePatch,
  memoryEntrySchema,
} from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;
const E1 = "00000000-0000-4000-8000-0000000000c1" as MemoryEntryId;
const E2 = "00000000-0000-4000-8000-0000000000c2" as MemoryEntryId;
const E3 = "00000000-0000-4000-8000-0000000000c3" as MemoryEntryId;
const FOREIGN = "00000000-0000-4000-8000-0000000000c4" as MemoryEntryId;
const MISSING = "00000000-0000-4000-8000-0000000000ff" as MemoryEntryId;
const TS = "2026-07-13T00:00:00.000Z";
const NOW = "2026-07-14T12:00:00.000Z";

function mem(id: MemoryEntryId, projectId: ProjectId = PROJECT_ID): MemoryEntry {
  return memoryEntrySchema.parse({
    id,
    projectId,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: `memory ${id.slice(-2)}`,
    content: `content ${id.slice(-2)}`,
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
}

function seed(registry: CoreRegistry): void {
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createProject({
    id: OTHER_PROJECT_ID,
    name: "other",
    rootPath: "/tmp/other",
    createdAt: TS,
    updatedAt: TS,
  });
  for (const id of [E1, E2, E3]) {
    registry.createMemoryEntry(mem(id));
  }
  registry.createMemoryEntry(mem(FOREIGN, OTHER_PROJECT_ID));
}

function itBehavesLikeBatchApply(makeRegistry: () => CoreRegistry): void {
  it("applies every patch in one batch and returns updated entries in order", () => {
    const registry = makeRegistry();
    seed(registry);
    const results = registry.applyMemoryEntryPatches(PROJECT_ID, [
      { id: E1, patch: { title: "one", updatedAt: NOW } },
      { id: E2, patch: { content: "two", updatedAt: NOW } },
      { id: E3, patch: { stale: true, updatedAt: NOW } },
    ]);
    expect(results.map((entry) => entry.id)).toEqual([E1, E2, E3]);
    expect(registry.getMemoryEntry(E1)?.title).toBe("one");
    expect(registry.getMemoryEntry(E2)?.content).toBe("two");
    expect(registry.getMemoryEntry(E3)?.stale).toBe(true);
    expect(registry.getMemoryEntry(E3)?.updatedAt).toBe(NOW);
  });

  it("duplicate id: later patch is applied on top of the earlier result", () => {
    const registry = makeRegistry();
    seed(registry);
    registry.applyMemoryEntryPatches(PROJECT_ID, [
      { id: E1, patch: { title: "first", updatedAt: NOW } },
      { id: E1, patch: { content: "second", updatedAt: NOW } },
    ]);
    const entry = registry.getMemoryEntry(E1);
    expect(entry?.title).toBe("first");
    expect(entry?.content).toBe("second");
  });

  it("whole-batch atomicity: invalid patch value rejects the batch, store untouched", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(() =>
      registry.applyMemoryEntryPatches(PROJECT_ID, [
        { id: E1, patch: { title: "should not persist", updatedAt: NOW } },
        { id: E2, patch: { title: "bad", updatedAt: "not-a-datetime" } },
      ]),
    ).toThrow();
    // A row-by-row writer would have persisted patch 1 before failing on
    // patch 2 — this assertion is the observable for "one store rewrite".
    expect(registry.getMemoryEntry(E1)?.title).not.toBe("should not persist");
  });

  it("unknown id mid-batch rejects the whole batch", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(() =>
      registry.applyMemoryEntryPatches(PROJECT_ID, [
        { id: E1, patch: { title: "should not persist", updatedAt: NOW } },
        { id: MISSING, patch: { title: "nope", updatedAt: NOW } },
      ]),
    ).toThrow(CoreRegistryError);
    expect(registry.getMemoryEntry(E1)?.title).not.toBe("should not persist");
  });

  it("cross-project id is not found under this projectId", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(() =>
      registry.applyMemoryEntryPatches(PROJECT_ID, [
        { id: FOREIGN, patch: { title: "nope", updatedAt: NOW } },
      ]),
    ).toThrow(CoreRegistryError);
  });

  it("strict patch validation matches updateMemoryEntry: unknown keys rejected", () => {
    const registry = makeRegistry();
    seed(registry);
    const bad = {
      projectId: OTHER_PROJECT_ID,
      updatedAt: NOW,
    } as unknown as MemoryEntryUpdatePatch;
    expect(() => registry.applyMemoryEntryPatches(PROJECT_ID, [{ id: E1, patch: bad }])).toThrow();
    expect(registry.getMemoryEntry(E1)?.projectId).toBe(PROJECT_ID);
  });

  it("empty patch list returns [] without writing", () => {
    const registry = makeRegistry();
    seed(registry);
    expect(registry.applyMemoryEntryPatches(PROJECT_ID, [])).toEqual([]);
    expect(registry.getMemoryEntry(E1)?.updatedAt).toBe(TS);
  });
}

describe("applyMemoryEntryPatches — in-memory registry", () => {
  itBehavesLikeBatchApply(createInMemoryCoreRegistry);
});

describe("applyMemoryEntryPatches — JSON directory registry", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-batch-apply-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  itBehavesLikeBatchApply(() => createJsonDirectoryCoreRegistry({ rootDir }));
});
