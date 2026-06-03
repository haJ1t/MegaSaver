import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleFetchChunk } from "../../src/tools/fetch-chunk.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

async function seedChunkSet(store: string, chunkSetId: string): Promise<void> {
  const dir = join(store, "content", PROJECT_ID, SESSION_ID);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${chunkSetId}.json`),
    JSON.stringify({
      chunkSetId,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: "2026-05-13T00:00:00.000Z",
      source: { kind: "file", path: "log.txt" },
      rawBytes: 10,
      redacted: true,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" }],
    }),
  );
}

describe("handleFetchChunk", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-fetch-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("returns the chunk on a hit", async () => {
    await seedChunkSet(store, "cs-1");
    const result = await handleFetchChunk(
      { storeRoot: store },
      { chunkSetId: "cs-1", chunkId: "0" },
    );
    expect(result).toEqual({
      chunkSetId: "cs-1",
      chunkId: "0",
      chunk: { id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" },
    });
  });

  it("throws content_store_miss on unknown chunkSetId", async () => {
    await expect(
      handleFetchChunk({ storeRoot: store }, { chunkSetId: "nope", chunkId: "0" }),
    ).rejects.toMatchObject({ name: "McpBridgeError", code: "content_store_miss" });
  });

  it("throws content_store_miss on unknown chunkId within a found set", async () => {
    await seedChunkSet(store, "cs-1");
    await expect(
      handleFetchChunk({ storeRoot: store }, { chunkSetId: "cs-1", chunkId: "99" }),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it("throws validation_failed on malformed args", async () => {
    await expect(
      handleFetchChunk({ storeRoot: store }, { chunkSetId: "", chunkId: "0" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
