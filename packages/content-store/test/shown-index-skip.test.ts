import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChunkSet } from "../src/chunk-set.js";
import { SHOWN_INDEX_FILENAME } from "../src/index.js";
import { listChunkSets, pruneOlderThan, saveChunkSet } from "../src/store.js";

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
  storeRoot = mkdtempSync(join(tmpdir(), "cs-shown-index-skip-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("SHOWN_INDEX_FILENAME constant", () => {
  it("is the expected reserved filename", () => {
    expect(SHOWN_INDEX_FILENAME).toBe("shown-index.json");
  });
});

describe("listChunkSets tolerates shown-index.json", () => {
  it("returns the chunk-set and does NOT throw on a sibling shown-index.json", async () => {
    await saveChunkSet({ storeRoot, chunkSet: makeChunkSet() });
    mkdirSync(sessionDir(), { recursive: true });
    writeFileSync(join(sessionDir(), SHOWN_INDEX_FILENAME), '{"abc123":{"chunkSetId":"cs-1"}}\n');
    const summaries = await listChunkSets({ storeRoot, projectId, sessionId });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.chunkSetId).toBe("cs-1");
  });
});

describe("pruneOlderThan tolerates shown-index.json", () => {
  it("does not delete shown-index.json and does not throw", async () => {
    await saveChunkSet({ storeRoot, chunkSet: makeChunkSet() });
    mkdirSync(sessionDir(), { recursive: true });
    const shownPath = join(sessionDir(), SHOWN_INDEX_FILENAME);
    writeFileSync(shownPath, '{"abc123":{"chunkSetId":"cs-1"}}\n');
    const res = await pruneOlderThan({
      storeRoot,
      olderThan: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(res.removed).toBe(1);
    expect(existsSync(shownPath)).toBe(true);
  });
});
