import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChunkSet } from "../src/chunk-set.js";
import { ContentStoreError } from "../src/errors.js";
import {
  deleteChunkSet,
  listChunkSets,
  loadChunkSet,
  pruneOlderThan,
  saveChunkSet,
} from "../src/store.js";

let storeRoot: string;
const projectId = projectIdSchema.parse(randomUUID());
const sessionId = sessionIdSchema.parse(randomUUID());

function makeChunkSet(overrides: Partial<ChunkSet> = {}): ChunkSet {
  return {
    chunkSetId: "cs-1",
    sessionId,
    projectId,
    createdAt: "2026-05-10T12:00:00.000Z",
    source: { kind: "file", path: "/tmp/x.txt" },
    rawBytes: 64,
    redacted: false,
    chunks: [{ id: "c1", startLine: 1, endLine: 2, bytes: 16, text: "hello" }],
    ...overrides,
  } as ChunkSet;
}

function sessionDir(): string {
  return join(storeRoot, "content", projectId, sessionId);
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "content-store-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("saveChunkSet / loadChunkSet roundtrip", () => {
  it("save then load returns a deep-equal ChunkSet", async () => {
    const cs = makeChunkSet();
    await saveChunkSet({ storeRoot, chunkSet: cs });
    const loaded = await loadChunkSet({
      storeRoot,
      projectId,
      sessionId,
      chunkSetId: cs.chunkSetId,
    });
    expect(loaded).toEqual(cs);
  });

  it("delete removes it; subsequent load throws not_found", async () => {
    const cs = makeChunkSet();
    await saveChunkSet({ storeRoot, chunkSet: cs });
    await deleteChunkSet({ storeRoot, projectId, sessionId, chunkSetId: cs.chunkSetId });
    await expect(
      loadChunkSet({ storeRoot, projectId, sessionId, chunkSetId: cs.chunkSetId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("preserves redacted=true", async () => {
    const cs = makeChunkSet({ chunkSetId: "cs-red-true", redacted: true });
    await saveChunkSet({ storeRoot, chunkSet: cs });
    const loaded = await loadChunkSet({
      storeRoot,
      projectId,
      sessionId,
      chunkSetId: cs.chunkSetId,
    });
    expect(loaded.redacted).toBe(true);
  });

  it("preserves redacted=false", async () => {
    const cs = makeChunkSet({ chunkSetId: "cs-red-false", redacted: false });
    await saveChunkSet({ storeRoot, chunkSet: cs });
    const loaded = await loadChunkSet({
      storeRoot,
      projectId,
      sessionId,
      chunkSetId: cs.chunkSetId,
    });
    expect(loaded.redacted).toBe(false);
  });
});

describe("loadChunkSet errors", () => {
  it("never-written id throws not_found", async () => {
    await expect(
      loadChunkSet({ storeRoot, projectId, sessionId, chunkSetId: "ghost" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("corrupt on-disk file throws store_corrupt", async () => {
    mkdirSync(sessionDir(), { recursive: true });
    writeFileSync(join(sessionDir(), "broken.json"), "{ not json");
    await expect(
      loadChunkSet({ storeRoot, projectId, sessionId, chunkSetId: "broken" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });
});

describe("saveChunkSet errors", () => {
  it("schema-invalid input throws schema_invalid", async () => {
    const bad = { ...makeChunkSet(), rawBytes: -5 } as ChunkSet;
    await expect(saveChunkSet({ storeRoot, chunkSet: bad })).rejects.toBeInstanceOf(
      ContentStoreError,
    );
    await expect(saveChunkSet({ storeRoot, chunkSet: bad })).rejects.toMatchObject({
      code: "schema_invalid",
    });
  });

  it("chunkSetId with a path separator throws write_failed", async () => {
    const bad = makeChunkSet({ chunkSetId: "a/b" });
    await expect(saveChunkSet({ storeRoot, chunkSet: bad })).rejects.toMatchObject({
      code: "write_failed",
    });
  });
});

describe("deleteChunkSet idempotency", () => {
  it("delete of an absent file does not throw", async () => {
    await expect(
      deleteChunkSet({ storeRoot, projectId, sessionId, chunkSetId: "absent" }),
    ).resolves.toBeUndefined();
  });
});

describe("listChunkSets", () => {
  it("returns [] for an empty / missing session", async () => {
    const result = await listChunkSets({ storeRoot, projectId, sessionId });
    expect(result).toEqual([]);
  });

  it("returns summaries with correct chunkCount", async () => {
    const a = makeChunkSet({ chunkSetId: "a", createdAt: "2026-05-10T10:00:00.000Z" });
    const b = makeChunkSet({
      chunkSetId: "b",
      createdAt: "2026-05-10T11:00:00.000Z",
      chunks: [
        { id: "c1", startLine: 1, endLine: 2, bytes: 8, text: "x" },
        { id: "c2", startLine: 3, endLine: 4, bytes: 8, text: "y" },
      ],
    });
    await saveChunkSet({ storeRoot, chunkSet: a });
    await saveChunkSet({ storeRoot, chunkSet: b });
    const summaries = [...(await listChunkSets({ storeRoot, projectId, sessionId }))].sort((x, y) =>
      x.createdAt.localeCompare(y.createdAt),
    );
    expect(summaries.map((s) => s.chunkSetId)).toEqual(["a", "b"]);
    expect(summaries.map((s) => s.chunkCount)).toEqual([1, 2]);
  });

  it("a single corrupt file throws store_corrupt", async () => {
    await saveChunkSet({ storeRoot, chunkSet: makeChunkSet({ chunkSetId: "ok" }) });
    writeFileSync(join(sessionDir(), "bad.json"), "{ nope");
    await expect(listChunkSets({ storeRoot, projectId, sessionId })).rejects.toMatchObject({
      code: "store_corrupt",
    });
  });
});

describe("pruneOlderThan", () => {
  it("returns { removed: 0 } when no content root exists", async () => {
    const result = await pruneOlderThan({ storeRoot, olderThan: new Date() });
    expect(result).toEqual({ removed: 0 });
  });

  it("removes only chunkSets with createdAt < olderThan", async () => {
    const old = makeChunkSet({ chunkSetId: "old", createdAt: "2026-01-01T00:00:00.000Z" });
    const fresh = makeChunkSet({ chunkSetId: "fresh", createdAt: "2026-12-01T00:00:00.000Z" });
    await saveChunkSet({ storeRoot, chunkSet: old });
    await saveChunkSet({ storeRoot, chunkSet: fresh });
    const result = await pruneOlderThan({
      storeRoot,
      olderThan: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result).toEqual({ removed: 1 });
    await expect(
      loadChunkSet({ storeRoot, projectId, sessionId, chunkSetId: "old" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      loadChunkSet({ storeRoot, projectId, sessionId, chunkSetId: "fresh" }),
    ).resolves.toMatchObject({ chunkSetId: "fresh" });
  });

  it("skips corrupt files (does not delete or count them)", async () => {
    const old = makeChunkSet({ chunkSetId: "old", createdAt: "2026-01-01T00:00:00.000Z" });
    await saveChunkSet({ storeRoot, chunkSet: old });
    writeFileSync(join(sessionDir(), "corrupt.json"), "{ broken");
    const result = await pruneOlderThan({
      storeRoot,
      olderThan: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result).toEqual({ removed: 1 });
  });
});
