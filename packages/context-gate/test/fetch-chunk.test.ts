import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const CHUNK_SET_ID = "cs-stored";
const TS = "2026-05-10T00:00:00.000Z";

async function seedChunkSet(store: string): Promise<void> {
  const dir = join(store, "content", PROJECT_ID, SESSION_ID);
  await mkdir(dir, { recursive: true });
  const chunkSet = {
    chunkSetId: CHUNK_SET_ID,
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: TS,
    source: { kind: "file", path: "/tmp/demo/log.txt" },
    rawBytes: 42,
    redacted: false,
    chunks: [
      { id: "0", startLine: 1, endLine: 3, bytes: 12, text: "first chunk\n" },
      { id: "1", startLine: 4, endLine: 6, bytes: 13, text: "second chunk\n" },
    ],
  };
  await writeFile(join(dir, `${CHUNK_SET_ID}.json`), JSON.stringify(chunkSet, null, 2));
}

describe("fetchChunk", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-fetch-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("returns the requested chunk on a hit", async () => {
    await seedChunkSet(store);
    const outcome = await fetchChunk({ storeRoot: store, chunkSetId: CHUNK_SET_ID, chunkId: "1" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.chunk.id).toBe("1");
      expect(outcome.chunk.text).toBe("second chunk\n");
    }
  });

  it("chunk_set_not_found for an unknown chunk-set id", async () => {
    await seedChunkSet(store);
    const outcome = await fetchChunk({ storeRoot: store, chunkSetId: "missing", chunkId: "0" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("chunk_set_not_found");
  });

  it("chunk_not_found for a known set but unknown chunk id", async () => {
    await seedChunkSet(store);
    const outcome = await fetchChunk({ storeRoot: store, chunkSetId: CHUNK_SET_ID, chunkId: "99" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("chunk_not_found");
  });

  it("store_corrupt for malformed JSON", async () => {
    const dir = join(store, "content", PROJECT_ID, SESSION_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${CHUNK_SET_ID}.json`), "{ not valid json");

    const outcome = await fetchChunk({ storeRoot: store, chunkSetId: CHUNK_SET_ID, chunkId: "0" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("store_corrupt");
  });
});
