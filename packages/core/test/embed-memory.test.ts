import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embed, readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type EmbedFn,
  embedMemoryEntries,
  memoryEmbedText,
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

// Deterministic counting fake: vector encodes the embed text so a re-embed of
// changed content yields a DIFFERENT vector than the prior one. No model.
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
  store = mkdtempSync(join(tmpdir(), "mega-embed-memory-"));
  sidecar = memoryEmbeddingsSidecarPath(store, PROJECT);
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("embedMemoryEntries — incremental carry-forward", () => {
  it("re-embeds only changed/new memories; carries unchanged vectors byte-identical", async () => {
    const r1 = countingEmbed();
    const round1 = [
      entry({ id: ID_A, content: "alpha decision", title: "Alpha" }),
      entry({ id: ID_B, content: "bravo decision", title: "Bravo" }),
    ];
    await embedMemoryEntries(store, PROJECT, round1, new Map(), r1.fn);
    expect(r1.texts.length).toBe(2);

    const after1 = readVectors(sidecar);
    const vecA1 = after1.get(ID_A);
    const vecB1 = after1.get(ID_B);
    expect(vecA1).toBeDefined();
    expect(vecB1).toBeDefined();

    // priorHashById captures the hashes BEFORE this round. A unchanged, B's
    // content changed → only B re-embeds.
    const priorHashById = new Map([
      [ID_A, hashOf("Alpha", "alpha decision")],
      [ID_B, hashOf("Bravo", "bravo decision")],
    ]);
    const r2 = countingEmbed();
    const round2 = [
      entry({ id: ID_A, content: "alpha decision", title: "Alpha" }),
      entry({ id: ID_B, content: "bravo decision CHANGED", title: "Bravo" }),
    ];
    await embedMemoryEntries(store, PROJECT, round2, priorHashById, r2.fn);

    expect(r2.texts.length).toBe(1);
    expect(r2.texts[0]).toContain("CHANGED");

    const after2 = readVectors(sidecar);
    expect(Array.from(after2.get(ID_A) ?? [])).toEqual(Array.from(vecA1 ?? []));
    expect(Array.from(after2.get(ID_B) ?? [])).not.toEqual(Array.from(vecB1 ?? []));
  });

  it("removes the sidecar entry for a memory dropped from the current set", async () => {
    const r1 = countingEmbed();
    await embedMemoryEntries(
      store,
      PROJECT,
      [entry({ id: ID_A, content: "a" }), entry({ id: ID_B, content: "b" })],
      new Map(),
      r1.fn,
    );
    const r2 = countingEmbed();
    await embedMemoryEntries(store, PROJECT, [entry({ id: ID_A, content: "a" })], new Map(), r2.fn);
    const after = readVectors(sidecar);
    expect(after.has(ID_A)).toBe(true);
    expect(after.has(ID_B)).toBe(false);
  });
});

describe("memoryEmbedText", () => {
  it("joins title and content (the recall surface)", () => {
    const text = memoryEmbedText(entry({ id: ID_A, content: "the body", title: "the title" }));
    expect(text).toContain("the title");
    expect(text).toContain("the body");
  });
});

// Real model path — OFF in CI (downloads ~50MB). Gate with MEGA_EMBED_E2E=1.
describe("embedMemoryEntries — real embed() E2E", () => {
  it.skipIf(!process.env.MEGA_EMBED_E2E)(
    "writes a real, non-trivial vector per memory via the live model",
    async () => {
      await embedMemoryEntries(
        store,
        PROJECT,
        [entry({ id: ID_A, content: "use jwt auth", title: "auth" })],
        new Map(),
        embed,
      );
      const vec = readVectors(sidecar).get(ID_A);
      expect(vec).toBeDefined();
      expect((vec?.length ?? 0) > 1).toBe(true);
    },
  );
});

// Mirror of the impl's content hash so the test's priorHashById matches.
function hashOf(title: string, content: string): string {
  return createHash("sha256").update(`${title}\n${content}`).digest("hex");
}
