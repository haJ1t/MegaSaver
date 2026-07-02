import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChunkSet } from "@megasaver/content-store";
import type { FilterOutputResult, RankFeatures } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistChunkSet } from "../src/read.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const CHUNK_SET_ID = "cs-outline-test";
const CREATED_AT = "2026-06-29T00:00:00.000Z";

function outlineResult(): FilterOutputResult {
  return {
    summary: "outline mode",
    excerpts: [
      { text: "skeleton text", startLine: 1, endLine: 9, score: 0, features: {} as RankFeatures },
    ],
    chunks: [
      { startLine: 3, endLine: 5, text: "export function alpha() { return 1; }" },
      { startLine: 7, endLine: 9, text: "export function beta() { return 2; }" },
    ],
    classification: { category: "unknown", confidence: 1 },
    decision: "outline",
    compressor: "generic",
    rawBytes: 100,
    returnedBytes: 13,
    rawTokens: 25,
    returnedTokens: 4,
    bytesSaved: 87,
    savingRatio: 0.87,
  };
}

function normalResult(): FilterOutputResult {
  return {
    summary: "normal mode",
    excerpts: [
      {
        text: "normal excerpt text",
        startLine: 1,
        endLine: 5,
        score: 0.9,
        features: {} as RankFeatures,
      },
    ],
    classification: { category: "unknown", confidence: 1 },
    decision: "compressed",
    compressor: "generic",
    rawBytes: 200,
    returnedBytes: 20,
    rawTokens: 50,
    returnedTokens: 5,
    bytesSaved: 180,
    savingRatio: 0.9,
  };
}

describe("persistChunkSet — outline bodies vs excerpts", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-persist-outline-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("persists outline bodies (chunks) when result has both excerpts and chunks", async () => {
    await persistChunkSet({
      storeRoot: store,
      chunkSetId: CHUNK_SET_ID,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: CREATED_AT,
      path: "/project/src/foo.ts",
      result: outlineResult(),
    });

    const loaded = await loadChunkSet({
      storeRoot: store,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      chunkSetId: CHUNK_SET_ID,
    });

    // Must have 2 body chunks, not 1 skeleton excerpt
    expect(loaded.chunks).toHaveLength(2);
    expect(loaded.chunks[0]?.text).toContain("return 1;");
    expect(loaded.chunks[1]?.text).toContain("return 2;");
    expect(loaded.chunks[1]?.id).toBe("1");
  });

  it("persists excerpts when result has no chunks field (normal mode)", async () => {
    const normalId = "cs-normal-test";
    await persistChunkSet({
      storeRoot: store,
      chunkSetId: normalId,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: CREATED_AT,
      path: "/project/src/bar.ts",
      result: normalResult(),
    });

    const loaded = await loadChunkSet({
      storeRoot: store,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      chunkSetId: normalId,
    });

    // Fallback: 1 excerpt persisted
    expect(loaded.chunks).toHaveLength(1);
    expect(loaded.chunks[0]?.text).toBe("normal excerpt text");
  });
});
