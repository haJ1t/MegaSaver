import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CodeBlock, codeBlockSchema } from "../src/code-block.js";
import { type EmbedFn, embedBlocks, embeddingsSidecarPath } from "../src/embed-blocks.js";
import type { IndexStorePaths } from "../src/store.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;

let store: string;
let paths: IndexStorePaths;

function block(id: string, contentHash: string, name: string): CodeBlock {
  return codeBlockSchema.parse({
    id,
    projectId: PROJECT_ID,
    filePath: "src/x.ts",
    startLine: 1,
    endLine: 5,
    blockType: "function",
    name,
    contentHash,
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: [],
  });
}

// Deterministic counting fake: vector encodes the embed text's first char code
// so a re-embed of changed content yields a DIFFERENT vector than the prior one.
function countingEmbed(): { fn: EmbedFn; texts: string[] } {
  const texts: string[] = [];
  const fn: EmbedFn = async (input) => {
    texts.push(...input);
    return input.map((t) => Float32Array.from([t.charCodeAt(0) ?? 0, t.length]));
  };
  return { fn, texts };
}

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-embed-blocks-"));
  paths = { indexDir: store, blocksPath: join(store, "blocks.jsonl"), manifestPath: "" };
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const ID_A = "00000000-0000-4000-8000-0000000000a1";
const ID_B = "00000000-0000-4000-8000-0000000000b1";
// A changed block gets a FRESH id on rebuild (build.ts re-extracts → newId()).
const ID_B2 = "00000000-0000-4000-8000-0000000000b2";

describe("embedBlocks — incremental carry-forward", () => {
  it("re-embeds only changed/new blocks; carries unchanged vectors byte-identical", async () => {
    // Round 1: two distinct blocks, nothing prior → both embedded.
    const r1 = countingEmbed();
    const round1 = [block(ID_A, "hashA", "alpha"), block(ID_B, "hashB", "bravo")];
    await embedBlocks(paths, round1, new Map(), r1.fn);
    expect(r1.texts.length).toBe(2); // both embedded on first build

    const after1 = readVectors(embeddingsSidecarPath(paths));
    const vecA1 = after1.get(ID_A);
    const vecB1 = after1.get(ID_B);
    expect(vecA1).toBeDefined();
    expect(vecB1).toBeDefined();

    // Round 2: block A UNCHANGED (same id + contentHash); block B CHANGED — its
    // content differs so build.ts re-extracts it under a FRESH id (ID_B2) with a
    // new contentHash. priorHashById reflects the PRIOR blocks (A=hashA, B=hashB).
    const priorHashById = new Map([
      [ID_A, "hashA"],
      [ID_B, "hashB"],
    ]);
    const r2 = countingEmbed();
    const round2 = [block(ID_A, "hashA", "alpha"), block(ID_B2, "hashB2", "bravo-changed")];
    await embedBlocks(paths, round2, priorHashById, r2.fn);

    // Only the changed/new block was embedded — the unchanged one was not.
    expect(r2.texts.length).toBe(1);
    expect(r2.texts[0]).toContain("bravo-changed");

    const after2 = readVectors(embeddingsSidecarPath(paths));
    // Unchanged block A: vector byte-identical to round 1 (carried forward).
    expect(Array.from(after2.get(ID_A) ?? [])).toEqual(Array.from(vecA1 ?? []));
    // Changed block: fresh vector, NOT the stale prior B vector.
    const vecB2 = after2.get(ID_B2);
    expect(vecB2).toBeDefined();
    expect(Array.from(vecB2 ?? [])).not.toEqual(Array.from(vecB1 ?? []));
    // Stale prior-id entry is gone (sidecar is rebuilt from the current set).
    expect(after2.has(ID_B)).toBe(false);
  });

  it("never carries a stale vector when contentHash changes under a reused id", async () => {
    // Defense in depth: even if an id were reused with DIFFERENT content (ids are
    // fresh-on-change in practice, but guard the contentHash check directly), the
    // block must be re-embedded, not carried.
    const r1 = countingEmbed();
    await embedBlocks(paths, [block(ID_A, "hashA", "alpha")], new Map(), r1.fn);
    const vec1 = readVectors(embeddingsSidecarPath(paths)).get(ID_A);

    const r2 = countingEmbed();
    // same id, DIFFERENT contentHash + content → must re-embed
    await embedBlocks(
      paths,
      [block(ID_A, "hashA-v2", "alpha-v2")],
      new Map([[ID_A, "hashA"]]),
      r2.fn,
    );
    expect(r2.texts.length).toBe(1);
    const vec2 = readVectors(embeddingsSidecarPath(paths)).get(ID_A);
    expect(Array.from(vec2 ?? [])).not.toEqual(Array.from(vec1 ?? []));
  });
});
