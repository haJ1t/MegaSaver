import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOutputChunk } from "../../src/commands/output/chunk.js";

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

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

describe("runOutputChunk", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-outchunk-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("happy path: returns one chunk, exit 0, { chunkSetId, chunkId, chunk } JSON shape", async () => {
    await seedChunkSet(store);

    const { out, err } = capture();
    const code = await runOutputChunk({
      chunkSetId: CHUNK_SET_ID,
      chunkId: "1",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
    });

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] ?? "") as {
      chunkSetId: string;
      chunkId: string;
      chunk: { id: string; text: string };
    };
    expect(parsed.chunkSetId).toBe(CHUNK_SET_ID);
    expect(parsed.chunkId).toBe("1");
    expect(parsed.chunk.id).toBe("1");
    expect(parsed.chunk.text).toBe("second chunk\n");
  });

  it("text mode prints the chunk text", async () => {
    await seedChunkSet(store);

    const { out, err } = capture();
    const code = await runOutputChunk({
      chunkSetId: CHUNK_SET_ID,
      chunkId: "0",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });

    expect(code).toBe(0);
    expect(out.some((l) => l.includes("first chunk"))).toBe(true);
  });

  it("unknown chunk-set id → chunk_set_not_found, exit 1", async () => {
    await seedChunkSet(store);

    const { out, err } = capture();
    const code = await runOutputChunk({
      chunkSetId: "does-not-exist",
      chunkId: "0",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("chunk_set_not_found"))).toBe(true);
  });

  it("known chunk-set, unknown chunkId → chunk_not_found, exit 1", async () => {
    await seedChunkSet(store);

    const { out, err } = capture();
    const code = await runOutputChunk({
      chunkSetId: CHUNK_SET_ID,
      chunkId: "99",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("chunk_not_found"))).toBe(true);
  });

  it("empty <chunk-set-id> → invalid_chunk_set_id, exit 1", async () => {
    const { out, err } = capture();
    const code = await runOutputChunk({
      chunkSetId: "",
      chunkId: "0",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("invalid_chunk_set_id"))).toBe(true);
  });

  it("empty <chunk-id> → invalid_chunk_id, exit 1", async () => {
    const { out, err } = capture();
    const code = await runOutputChunk({
      chunkSetId: CHUNK_SET_ID,
      chunkId: "",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("invalid_chunk_id"))).toBe(true);
  });

  it("corrupt stored file → store_corrupt, exit 1", async () => {
    const dir = join(store, "content", PROJECT_ID, SESSION_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${CHUNK_SET_ID}.json`), "{ not valid json");

    const { out, err } = capture();
    const code = await runOutputChunk({
      chunkSetId: CHUNK_SET_ID,
      chunkId: "0",
      storeFlag: store,
      cwd: "/tmp",
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("store_corrupt"))).toBe(true);
  });
});
