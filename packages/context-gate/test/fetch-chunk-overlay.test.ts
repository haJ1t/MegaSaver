import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveOverlayChunkSet } from "@megasaver/content-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";

const WK = "7da3a87ecc581dd6";
const LIVE = "ae662232-619e-4c84-b860-e38473ffa7ea";
const SET = "a9c9e447-d3d4-4251-abef-5773f8caafc2";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-cg-overlay-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

async function seedOverlay(): Promise<void> {
  await saveOverlayChunkSet({
    storeRoot: store,
    chunkSet: {
      chunkSetId: SET,
      workspaceKey: WK,
      liveSessionId: LIVE,
      createdAt: "2026-07-09T12:00:00.000Z",
      source: { kind: "command", command: "pnpm verify", args: [] },
      rawBytes: 11,
      redacted: false,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 11, text: "full output" }],
    },
  });
}

describe("fetchChunk — overlay layout", () => {
  it("reads a hook-written overlay chunk set (the live C11 repro)", async () => {
    await seedOverlay();
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "0" });
    expect(out).toEqual({
      ok: true,
      chunk: { id: "0", startLine: 1, endLine: 1, bytes: 11, text: "full output" },
    });
  });

  it("returns chunk_not_found for a missing chunk id in an overlay set", async () => {
    await seedOverlay();
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "9" });
    expect(out).toEqual({ ok: false, reason: "chunk_not_found" });
  });

  it("survives a stray non-directory under content/ (C15 .DS_Store)", async () => {
    await seedOverlay();
    writeFileSync(join(store, "content", ".DS_Store"), "junk");
    mkdirSync(join(store, "content", WK, "not-a-dir-holder"), { recursive: true });
    writeFileSync(join(store, "content", WK, ".DS_Store"), "junk");
    const out = await fetchChunk({ storeRoot: store, chunkSetId: SET, chunkId: "0" });
    expect(out.ok).toBe(true);
  });

  it("still returns chunk_set_not_found for an unknown id", async () => {
    await seedOverlay();
    const out = await fetchChunk({
      storeRoot: store,
      chunkSetId: "00000000-0000-4000-8000-000000000000",
      chunkId: "0",
    });
    expect(out).toEqual({ ok: false, reason: "chunk_set_not_found" });
  });
});
