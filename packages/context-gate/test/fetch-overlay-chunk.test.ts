import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OverlayChunkSet, saveOverlayChunkSet } from "@megasaver/content-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchOverlayChunk } from "../src/fetch-overlay-chunk.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "ctxgate-ovl-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const sample: OverlayChunkSet = {
  chunkSetId: "cs1",
  workspaceKey: "ws",
  liveSessionId: "live1",
  createdAt: "2026-06-25T00:00:00.000Z",
  source: { kind: "command", command: "ls", args: [] },
  rawBytes: 5,
  redacted: false,
  chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" }],
};

describe("fetchOverlayChunk", () => {
  it("returns the stored chunk", async () => {
    await saveOverlayChunkSet({ storeRoot: store, chunkSet: sample });
    const res = await fetchOverlayChunk({
      storeRoot: store,
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "cs1",
      chunkId: "0",
    });
    expect(res).toEqual({ ok: true, chunk: sample.chunks[0] });
  });

  it("reports a missing chunk set", async () => {
    const res = await fetchOverlayChunk({
      storeRoot: store,
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "nope",
      chunkId: "0",
    });
    expect(res).toEqual({ ok: false, reason: "chunk_set_not_found" });
  });

  it("reports a missing chunk id within an existing set", async () => {
    await saveOverlayChunkSet({ storeRoot: store, chunkSet: sample });
    const res = await fetchOverlayChunk({
      storeRoot: store,
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "cs1",
      chunkId: "99",
    });
    expect(res).toEqual({ ok: false, reason: "chunk_not_found" });
  });
});
