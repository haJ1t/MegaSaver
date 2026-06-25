import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChunkSet } from "../src/chunk-set.js";
import { READ_INDEX_FILENAME } from "../src/index.js";
import { listChunkSets, saveChunkSet } from "../src/store.js";

let storeRoot: string;
const projectId = projectIdSchema.parse(randomUUID());
const sessionId = sessionIdSchema.parse(randomUUID());

function makeChunkSet(): ChunkSet {
  return {
    chunkSetId: "cs-1",
    sessionId,
    projectId,
    createdAt: "2026-05-10T12:00:00.000Z",
    source: { kind: "file", path: "/tmp/x.txt" },
    rawBytes: 64,
    redacted: false,
    chunks: [{ id: "c1", startLine: 1, endLine: 2, bytes: 16, text: "hello" }],
  } as ChunkSet;
}

function sessionDir(): string {
  return join(storeRoot, "content", projectId, sessionId);
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "cs-read-index-skip-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("listChunkSets tolerates read-index.json (C1a, T13)", () => {
  it("returns the chunk-set and does NOT throw on a sibling read-index.json", async () => {
    await saveChunkSet({ storeRoot, chunkSet: makeChunkSet() });
    mkdirSync(sessionDir(), { recursive: true });
    writeFileSync(
      join(sessionDir(), READ_INDEX_FILENAME),
      '{"abc":{"contentHash":"h","chunkSetId":"cs-1"}}\n',
    );

    const summaries = await listChunkSets({ storeRoot, projectId, sessionId });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.chunkSetId).toBe("cs-1");
  });

  it("exposes the reserved filename constant value", () => {
    expect(READ_INDEX_FILENAME).toBe("read-index.json");
  });
});

describe("listChunkSets still surfaces genuine corruption (C1a, T14)", () => {
  it("throws store_corrupt on a non-ChunkSet json that is not the reserved name", async () => {
    mkdirSync(sessionDir(), { recursive: true });
    writeFileSync(join(sessionDir(), "garbage.json"), '{"not":"a chunkset"}');
    await expect(listChunkSets({ storeRoot, projectId, sessionId })).rejects.toMatchObject({
      code: "store_corrupt",
    });
  });
});
