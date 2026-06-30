import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  memoryEmbeddingsSidecarPath,
  taskRelevantMemoryFiles,
  taskScopedMemoryFiles,
} from "../src/index.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";

const PROJECT = "00000000-0000-4000-8000-000000000001" as ProjectId;
const TS = "2026-06-11T00:00:00.000Z";

function entry(over: Partial<MemoryEntry> & { id: string; relatedFiles?: string[] }): MemoryEntry {
  return memoryEntrySchema.parse({
    id: over.id,
    projectId: PROJECT,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: over.title ?? "t",
    content: over.content ?? "c",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: over.approval ?? "approved",
    stale: over.stale ?? false,
    relatedFiles: over.relatedFiles ?? [],
    createdAt: TS,
    updatedAt: TS,
    ...(over.validFrom !== undefined ? { validFrom: over.validFrom } : {}),
    ...(over.validTo !== undefined ? { validTo: over.validTo } : {}),
  });
}

// Pure helper: rank approved+current+non-stale memories by cosine(task, memory)
// and return the deduped union of the top-K memories' relatedFiles.
describe("taskRelevantMemoryFiles (pure)", () => {
  const NEAR = "00000000-0000-4000-8000-0000000000a1";
  const FAR = "00000000-0000-4000-8000-0000000000a2";
  const taskVector = Float32Array.from([1, 0, 0]);

  it("includes a task-NEAR memory's file and excludes a task-FAR memory's file", () => {
    const memories = [
      entry({ id: NEAR, relatedFiles: ["src/near.ts"] }),
      entry({ id: FAR, relatedFiles: ["src/far.ts"] }),
    ];
    const memoryVectors = new Map([
      [NEAR, Float32Array.from([0.9, 0.1, 0])],
      [FAR, Float32Array.from([0, 0, 1])],
    ]);
    const files = taskRelevantMemoryFiles(memories, {
      taskVector,
      memoryVectors,
      topK: 1,
      asOf: TS,
    });
    expect(files).toContain("src/near.ts");
    expect(files).not.toContain("src/far.ts");
  });

  it("respects topK (only the top-K memories' files are returned)", () => {
    const A = "00000000-0000-4000-8000-0000000000b1";
    const B = "00000000-0000-4000-8000-0000000000b2";
    const C = "00000000-0000-4000-8000-0000000000b3";
    const memories = [
      entry({ id: A, relatedFiles: ["src/a.ts"] }),
      entry({ id: B, relatedFiles: ["src/b.ts"] }),
      entry({ id: C, relatedFiles: ["src/c.ts"] }),
    ];
    const memoryVectors = new Map([
      [A, Float32Array.from([1, 0, 0])],
      [B, Float32Array.from([0.8, 0.2, 0])],
      [C, Float32Array.from([0.1, 0.9, 0])],
    ]);
    const files = taskRelevantMemoryFiles(memories, {
      taskVector,
      memoryVectors,
      topK: 2,
      asOf: TS,
    });
    expect(files.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("dedupes related files across the selected memories", () => {
    const A = "00000000-0000-4000-8000-0000000000c1";
    const B = "00000000-0000-4000-8000-0000000000c2";
    const memories = [
      entry({ id: A, relatedFiles: ["src/shared.ts"] }),
      entry({ id: B, relatedFiles: ["src/shared.ts"] }),
    ];
    const memoryVectors = new Map([
      [A, Float32Array.from([1, 0, 0])],
      [B, Float32Array.from([0.9, 0.1, 0])],
    ]);
    const files = taskRelevantMemoryFiles(memories, {
      taskVector,
      memoryVectors,
      topK: 10,
      asOf: TS,
    });
    expect(files).toEqual(["src/shared.ts"]);
  });

  it("counts only approved, current, non-stale memories (signal safety)", () => {
    const APPROVED = "00000000-0000-4000-8000-0000000000d1";
    const SUGGESTED = "00000000-0000-4000-8000-0000000000d2";
    const STALE = "00000000-0000-4000-8000-0000000000d3";
    const CLOSED = "00000000-0000-4000-8000-0000000000d4";
    const memories = [
      entry({ id: APPROVED, relatedFiles: ["src/approved.ts"] }),
      entry({ id: SUGGESTED, approval: "suggested", relatedFiles: ["src/suggested.ts"] }),
      entry({ id: STALE, stale: true, relatedFiles: ["src/stale.ts"] }),
      entry({
        id: CLOSED,
        relatedFiles: ["src/closed.ts"],
        validTo: "2026-06-10T00:00:00.000Z",
      }),
    ];
    // Every memory's vector is identical to the task vector — only the gating,
    // not the cosine score, can exclude a file here.
    const memoryVectors = new Map(
      memories.map((m) => [m.id, Float32Array.from([1, 0, 0])] as const),
    );
    const files = taskRelevantMemoryFiles(memories, {
      taskVector,
      memoryVectors,
      topK: 10,
      asOf: TS,
    });
    expect(files).toEqual(["src/approved.ts"]);
  });

  it("does not DROP a genuinely task-relevant memory's file (recall safety)", () => {
    // The whole point of the increment: a memory near the task must keep its file.
    const memories = [entry({ id: NEAR, relatedFiles: ["src/keepme.ts"] })];
    const memoryVectors = new Map([[NEAR, Float32Array.from([1, 0, 0])]]);
    const files = taskRelevantMemoryFiles(memories, {
      taskVector,
      memoryVectors,
      topK: 10,
      asOf: TS,
    });
    expect(files).toEqual(["src/keepme.ts"]);
  });
});

// Best-effort orchestrator: load the project's memory sidecar, use an injected
// task vector (reused from the caller) or embed the task, rank, return scoped
// files. null on no-sidecar / empty sidecar / any failure → caller falls back.
describe("taskScopedMemoryFiles (best-effort orchestrator)", () => {
  const NEAR = "00000000-0000-4000-8000-0000000000e1";
  const FAR = "00000000-0000-4000-8000-0000000000e2";
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "core-taskscope-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  function seed(): MemoryEntry[] {
    return [
      entry({ id: NEAR, relatedFiles: ["src/near.ts"] }),
      entry({ id: FAR, relatedFiles: ["src/far.ts"] }),
    ];
  }

  it("returns the task-scoped file set when a sidecar + injected task vector are present", async () => {
    writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT), [
      { id: NEAR, vector: [0.9, 0.1, 0] },
      { id: FAR, vector: [0, 0, 1] },
    ]);
    const files = await taskScopedMemoryFiles({
      storeRoot: store,
      projectId: PROJECT,
      memories: seed(),
      task: "anything",
      taskVector: Float32Array.from([1, 0, 0]),
      topK: 1,
      asOf: TS,
    });
    expect(files).not.toBeNull();
    expect(files).toContain("src/near.ts");
    expect(files).not.toContain("src/far.ts");
  });

  it("returns null when no sidecar exists (caller falls back to all-approved)", async () => {
    const files = await taskScopedMemoryFiles({
      storeRoot: store,
      projectId: PROJECT,
      memories: seed(),
      task: "anything",
      taskVector: Float32Array.from([1, 0, 0]),
      asOf: TS,
    });
    expect(files).toBeNull();
  });

  it("embeds the task itself when no task vector is injected (CLI path)", async () => {
    writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT), [
      { id: NEAR, vector: [0.9, 0.1, 0] },
      { id: FAR, vector: [0, 0, 1] },
    ]);
    const files = await taskScopedMemoryFiles({
      storeRoot: store,
      projectId: PROJECT,
      memories: seed(),
      task: "anything",
      embedFn: async () => [Float32Array.from([1, 0, 0])],
      topK: 1,
      asOf: TS,
    });
    expect(files).toContain("src/near.ts");
    expect(files).not.toContain("src/far.ts");
  });

  it("returns null and never throws when embedding fails", async () => {
    writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT), [
      { id: NEAR, vector: [0.9, 0.1, 0] },
      { id: FAR, vector: [0, 0, 1] },
    ]);
    const files = await taskScopedMemoryFiles({
      storeRoot: store,
      projectId: PROJECT,
      memories: seed(),
      task: "anything",
      embedFn: async () => {
        throw new Error("model unavailable");
      },
      asOf: TS,
    });
    expect(files).toBeNull();
  });
});
