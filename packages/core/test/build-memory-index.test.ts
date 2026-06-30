import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type EmbedFn,
  buildMemoryIndex,
  memoryEmbeddingsSidecarPath,
} from "../src/embed-memory.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";

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
  });
}

function countingEmbed(): { fn: EmbedFn; texts: string[] } {
  const texts: string[] = [];
  const fn: EmbedFn = async (input) => {
    texts.push(...input);
    return input.map((t) => Float32Array.from([t.charCodeAt(0) ?? 0, t.length]));
  };
  return { fn, texts };
}

const ID_A = "00000000-0000-4000-8000-0000000000a1";
const ID_B = "00000000-0000-4000-8000-0000000000b1";

let store: string;
let sidecar: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-build-memory-"));
  sidecar = memoryEmbeddingsSidecarPath(store, PROJECT);
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("buildMemoryIndex — on-demand index build", () => {
  it("embeds every memory on the first build and reports counts", async () => {
    const r1 = countingEmbed();
    const result = await buildMemoryIndex(
      store,
      PROJECT,
      [
        entry({ id: ID_A, content: "alpha decision", title: "Alpha" }),
        entry({ id: ID_B, content: "bravo decision", title: "Bravo" }),
      ],
      r1.fn,
    );
    expect(result).toEqual({ embedded: 2, carried: 0, total: 2 });
    expect(r1.texts.length).toBe(2);
    const after = readVectors(sidecar);
    expect(after.has(ID_A)).toBe(true);
    expect(after.has(ID_B)).toBe(true);
  });

  it("re-embeds only the changed memory on rebuild; carries the rest forward", async () => {
    const r1 = countingEmbed();
    await buildMemoryIndex(
      store,
      PROJECT,
      [
        entry({ id: ID_A, content: "alpha decision", title: "Alpha" }),
        entry({ id: ID_B, content: "bravo decision", title: "Bravo" }),
      ],
      r1.fn,
    );
    const vecA1 = readVectors(sidecar).get(ID_A);

    const r2 = countingEmbed();
    const result = await buildMemoryIndex(
      store,
      PROJECT,
      [
        entry({ id: ID_A, content: "alpha decision", title: "Alpha" }),
        entry({ id: ID_B, content: "bravo decision CHANGED", title: "Bravo" }),
      ],
      r2.fn,
    );

    expect(result).toEqual({ embedded: 1, carried: 1, total: 2 });
    expect(r2.texts.length).toBe(1);
    expect(r2.texts[0]).toContain("CHANGED");
    // Unchanged A carried byte-identical; no re-embed.
    expect(Array.from(readVectors(sidecar).get(ID_A) ?? [])).toEqual(Array.from(vecA1 ?? []));
  });

  it("carries everything forward when nothing changed (zero re-embeds)", async () => {
    const r1 = countingEmbed();
    const memories = [
      entry({ id: ID_A, content: "alpha decision", title: "Alpha" }),
      entry({ id: ID_B, content: "bravo decision", title: "Bravo" }),
    ];
    await buildMemoryIndex(store, PROJECT, memories, r1.fn);

    const r2 = countingEmbed();
    const result = await buildMemoryIndex(store, PROJECT, memories, r2.fn);
    expect(result).toEqual({ embedded: 0, carried: 2, total: 2 });
    expect(r2.texts.length).toBe(0);
  });

  it("drops the sidecar entry for a removed memory", async () => {
    const r1 = countingEmbed();
    await buildMemoryIndex(
      store,
      PROJECT,
      [entry({ id: ID_A, content: "a" }), entry({ id: ID_B, content: "b" })],
      r1.fn,
    );
    const r2 = countingEmbed();
    const result = await buildMemoryIndex(
      store,
      PROJECT,
      [entry({ id: ID_A, content: "a" })],
      r2.fn,
    );
    expect(result).toEqual({ embedded: 0, carried: 1, total: 1 });
    const after = readVectors(sidecar);
    expect(after.has(ID_A)).toBe(true);
    expect(after.has(ID_B)).toBe(false);
  });
});

describe("buildMemoryIndex — count reflects the embedder's real decision", () => {
  it("counts a memory as embedded when its vector is missing even though its hash carried", async () => {
    const r1 = countingEmbed();
    const memories = [
      entry({ id: ID_A, content: "alpha decision", title: "Alpha" }),
      entry({ id: ID_B, content: "bravo decision", title: "Bravo" }),
    ];
    await buildMemoryIndex(store, PROJECT, memories, r1.fn);

    // Simulate a vector sidecar that lost A's vector while the hash manifest
    // still records A (e.g. a partial/older write). A hash-only count would call
    // A "carried"; the embedder must re-embed it (no prior vector), so the
    // reported count must say embedded includes A.
    const writeVectorsModule = await import("@megasaver/embeddings");
    writeVectorsModule.writeVectors(sidecar, [
      { id: ID_B, vector: Array.from(readVectors(sidecar).get(ID_B) ?? []) },
    ]);

    const r2 = countingEmbed();
    const result = await buildMemoryIndex(store, PROJECT, memories, r2.fn);
    expect(r2.texts.length).toBe(1); // only A re-embedded
    expect(result).toEqual({ embedded: 1, carried: 1, total: 2 });
  });
});

// Real model path — OFF in CI. Gate with MEGA_EMBED_E2E=1.
describe("buildMemoryIndex — real embed() E2E", () => {
  it.skipIf(!process.env.MEGA_EMBED_E2E)("builds a real sidecar via the live model", async () => {
    const result = await buildMemoryIndex(
      store,
      PROJECT,
      [entry({ id: ID_A, content: "use jwt auth", title: "auth" })],
      embed,
    );
    expect(result).toEqual({ embedded: 1, carried: 0, total: 1 });
    const vec = readVectors(sidecar).get(ID_A);
    expect((vec?.length ?? 0) > 1).toBe(true);
  });
});
