import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CoreRegistry,
  createInMemoryCoreRegistry,
  memoryEmbeddingsSidecarPath,
} from "@megasaver/core";
import { writeVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleGetRelevantMemories } from "../../src/tools/get-relevant-memories.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";
const NEAR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FAR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THIRD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  // Two approved memories with IDENTICAL lexical text so BM25 ties — only the
  // injected sidecar vectors can separate them.
  for (const id of [NEAR, FAR]) {
    registry.createMemoryEntry({
      id,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "handler data io",
      type: "decision",
      title: "handler",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      createdAt: TS,
      updatedAt: TS,
    });
  }
  return registry;
}

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mcp-relevant-semantic-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("handleGetRelevantMemories — semantic boundary signal", () => {
  it("ranks by injected sidecar vectors when present (NEAR before FAR)", async () => {
    const registry = seededRegistry();
    // Sidecar: NEAR vector close to the fake query vector, FAR orthogonal.
    writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT_ID as ProjectId), [
      { id: NEAR, vector: [0.9, 0.1, 0] },
      { id: FAR, vector: [0, 0, 1] },
    ]);
    // Injected embed: any query → the [1,0,0] direction. No model.
    const fakeEmbed = async () => [Float32Array.from([1, 0, 0])];

    const result = await handleGetRelevantMemories(
      { registry, storeRoot: store, embedFn: fakeEmbed },
      { projectId: PROJECT_ID, task: "handler" },
    );
    expect(result.memory.map((m) => m.id)).toEqual([NEAR, FAR]);
  });

  it("falls back to BM25 when no sidecar exists (graceful, no model)", async () => {
    const registry = seededRegistry();
    // No sidecar written. An embed that THROWS would still be fine, but it must
    // never even be required to produce a result.
    const throwingEmbed = async () => {
      throw new Error("model unavailable");
    };
    const result = await handleGetRelevantMemories(
      { registry, storeRoot: store, embedFn: throwingEmbed },
      { projectId: PROJECT_ID, task: "handler" },
    );
    // BM25 returns both (identical lexical match); never throws.
    expect(result.memory.map((m) => m.id).sort()).toEqual([NEAR, FAR].sort());
  });

  it("falls back to BM25 when embed throws even though a sidecar exists", async () => {
    const registry = seededRegistry();
    writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT_ID as ProjectId), [
      { id: NEAR, vector: [1, 0, 0] },
      { id: FAR, vector: [1, 0, 0] },
    ]);
    const throwingEmbed = async () => {
      throw new Error("model unavailable");
    };
    const result = await handleGetRelevantMemories(
      { registry, storeRoot: store, embedFn: throwingEmbed },
      { projectId: PROJECT_ID, task: "handler" },
    );
    expect(result.memory.map((m) => m.id).sort()).toEqual([NEAR, FAR].sort());
  });

  it("falls back to BM25 on a PARTIAL sidecar so no approved memory silently vanishes", async () => {
    // Default steady state: a memory approved after the last manual sidecar build
    // is un-vectored. Three approved memories all match the query; the sidecar
    // covers only two. Ranking the partial sidecar would drop THIRD silently —
    // the coverage guard must instead fall back to BM25, which returns all three.
    const registry = seededRegistry();
    registry.createMemoryEntry({
      id: THIRD,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "handler data io",
      type: "decision",
      title: "handler",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      createdAt: TS,
      updatedAt: TS,
    });
    writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT_ID as ProjectId), [
      { id: NEAR, vector: [1, 0, 0] },
      { id: FAR, vector: [0.5, 0.5, 0] },
    ]);
    const fakeEmbed = async () => [Float32Array.from([1, 0, 0])];

    const result = await handleGetRelevantMemories(
      { registry, storeRoot: store, embedFn: fakeEmbed },
      { projectId: PROJECT_ID, task: "handler" },
    );
    expect(result.memory.map((m) => m.id).sort()).toEqual([NEAR, FAR, THIRD].sort());
  });
});
