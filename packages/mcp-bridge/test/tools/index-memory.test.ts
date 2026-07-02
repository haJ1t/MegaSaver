import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleGetRelevantMemories } from "../../src/tools/get-relevant-memories.js";
import { handleIndexMemory } from "../../src/tools/index-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const TS = "2026-06-11T00:00:00.000Z";
const LEX = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as MemoryEntryId; // matches the BM25 query term
const SEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as MemoryEntryId; // matched only by the vector

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  // LEX shares the query's lexical term "handler"; SEM does not. So BM25 (the
  // pre-build fallback) ranks LEX first / drops SEM. The sidecar vectors will
  // flip this so SEM ranks first — an order BM25 can never produce.
  add(registry, LEX, "handler", "handler routing decision");
  add(registry, SEM, "storage", "vector store layout decision");
  return registry;
}

function add(registry: CoreRegistry, id: MemoryEntryId, title: string, content: string): void {
  registry.createMemoryEntry({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    content,
    type: "decision",
    title,
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
}

// Build-time embed keyed on the memory's embed text (title\ncontent): SEM's text
// → [0,1], LEX's text → [1,0]. Deterministic, no model.
const buildEmbed = async (texts: readonly string[]) =>
  texts.map((t) =>
    Float32Array.from([t.includes("storage") ? 0 : 1, t.includes("storage") ? 1 : 0]),
  );

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mcp-index-memory-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("handleIndexMemory", () => {
  it("builds the sidecar and reports counts (model-free)", async () => {
    const registry = seededRegistry();
    const result = await handleIndexMemory(
      { registry, storeRoot: store, embedFn: buildEmbed },
      { projectId: PROJECT_ID },
    );
    expect(result).toEqual({ embedded: 2, carried: 0, total: 2 });
  });

  it("closes the gap: after a build, get_relevant_memories takes the semantic path (full coverage, not BM25 fallback)", async () => {
    const registry = seededRegistry();

    // BEFORE: no sidecar → coverage guard trips → BM25 fallback. BM25 over the
    // term "handler" matches LEX only.
    const before = await handleGetRelevantMemories(
      { registry, storeRoot: store, embedFn: buildEmbed },
      { projectId: PROJECT_ID, task: "handler" },
    );
    expect(before.memory.map((m) => m.id)).toEqual([LEX]);

    // Build the sidecar via the new MCP tool.
    await handleIndexMemory(
      { registry, storeRoot: store, embedFn: buildEmbed },
      { projectId: PROJECT_ID },
    );

    // AFTER: full coverage → semantic path. Query embeds to SEM's direction
    // [0,1], so SEM (which BM25 dropped) now ranks FIRST. This output is
    // impossible for the BM25 fallback → proves the semantic path now runs.
    const after = await handleGetRelevantMemories(
      { registry, storeRoot: store, embedFn: async () => [Float32Array.from([0, 1])] },
      { projectId: PROJECT_ID, task: "handler" },
    );
    expect(after.memory.map((m) => m.id)).toEqual([SEM, LEX]);
  });
});
