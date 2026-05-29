import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateChunkSet } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const CHUNK_SET_ID = "cs-abc";

describe("locateChunkSet", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-locate-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("returns { projectId, sessionId } for a stored chunk-set id", async () => {
    const dir = join(store, "content", PROJECT_ID, SESSION_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${CHUNK_SET_ID}.json`), "{}");

    const located = locateChunkSet({ storeRoot: store, chunkSetId: CHUNK_SET_ID });
    expect(located).toEqual({ projectId: PROJECT_ID, sessionId: SESSION_ID });
  });

  it("returns null for an unknown chunk-set id", async () => {
    const dir = join(store, "content", PROJECT_ID, SESSION_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${CHUNK_SET_ID}.json`), "{}");

    expect(locateChunkSet({ storeRoot: store, chunkSetId: "missing" })).toBeNull();
  });

  it("returns null when no content directory exists", () => {
    expect(locateChunkSet({ storeRoot: store, chunkSetId: CHUNK_SET_ID })).toBeNull();
  });
});
