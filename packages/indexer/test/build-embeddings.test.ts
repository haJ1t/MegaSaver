import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVectors } from "@megasaver/embeddings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIndex } from "../src/build.js";
import { resolveIndexPaths } from "../src/store.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

let repo: string;
let store: string;
let counter: number;

function newId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

function embeddingsPath(): string {
  return join(resolveIndexPaths(store, PROJECT_ID).indexDir, "embeddings.jsonl");
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mega-repo-"));
  store = mkdtempSync(join(tmpdir(), "mega-store-"));
  counter = 0;
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "export function a() { return 1; }\n");
  writeFileSync(join(repo, "src", "b.ts"), "export function b() { return 2; }\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

describe("buildIndex — embeddings opt-in", () => {
  it("default build (embeddings omitted) writes NO sidecar and stays as today", async () => {
    const result = await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
    });
    expect(result.blockCount).toBe(2);
    expect(existsSync(embeddingsPath())).toBe(false);
  });

  it("explicit embeddings:false writes NO sidecar", async () => {
    await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
      embeddings: false,
    });
    expect(existsSync(embeddingsPath())).toBe(false);
  });
});

// Gated: the ONLY build test that calls real embed() (downloads the model on
// first run). CI never sets MEGA_EMBED_E2E, so it is skipped there.
// Run locally with: MEGA_EMBED_E2E=1 pnpm --filter @megasaver/indexer test
describe.skipIf(!process.env.MEGA_EMBED_E2E)("buildIndex — embeddings:true (real model)", () => {
  it("writes a sidecar keyed by block id with one vector per block", async () => {
    await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
      embeddings: true,
    });
    const vectors = readVectors(embeddingsPath());
    expect(vectors.size).toBe(2);
    for (const v of vectors.values()) {
      expect(v.length).toBe(384);
    }
  });

  it("carries unchanged-block vectors forward without re-embedding", async () => {
    await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
      embeddings: true,
    });
    const before = readVectors(embeddingsPath());
    // change only a.ts; b.ts is unchanged and must keep its vector
    writeFileSync(join(repo, "src", "a.ts"), "export function a() { return 99; }\n");
    await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
      embeddings: true,
    });
    const after = readVectors(embeddingsPath());
    expect(after.size).toBe(2);
    // every persisted block still has a vector after the incremental rebuild
    for (const v of after.values()) expect(v.length).toBe(384);
    expect(before.size).toBe(2);
  });
});
