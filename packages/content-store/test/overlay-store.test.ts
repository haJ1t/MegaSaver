import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverlayChunkSet } from "../src/chunk-set.js";
import { ContentStoreError } from "../src/errors.js";
import { loadOverlayChunkSet, saveOverlayChunkSet } from "../src/store.js";

const WK = "0123456789abcdef";
const LSID = "11111111-1111-4111-8111-111111111111";

let storeRoot: string;

function makeOverlayChunkSet(overrides: Partial<OverlayChunkSet> = {}): OverlayChunkSet {
  return {
    chunkSetId: "cs-1",
    liveSessionId: LSID,
    workspaceKey: WK,
    createdAt: "2026-05-10T12:00:00.000Z",
    source: { kind: "file", path: "/tmp/x.txt" },
    rawBytes: 64,
    redacted: false,
    chunks: [{ id: "c1", startLine: 1, endLine: 2, bytes: 16, text: "hello" }],
    ...overrides,
  } as OverlayChunkSet;
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "content-overlay-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("saveOverlayChunkSet / loadOverlayChunkSet", () => {
  it("writes content/<wk>/<lsid>/<chunkSetId>.json and reads it back", async () => {
    const cs = makeOverlayChunkSet();
    await saveOverlayChunkSet({ storeRoot, chunkSet: cs });
    expect(existsSync(join(storeRoot, "content", WK, LSID, "cs-1.json"))).toBe(true);
    const loaded = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: LSID,
      chunkSetId: "cs-1",
    });
    expect(loaded).toEqual(cs);
  });

  it("throws not_found for a missing chunk set", async () => {
    await expect(
      loadOverlayChunkSet({
        storeRoot,
        workspaceKey: WK,
        liveSessionId: LSID,
        chunkSetId: "nope",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a traversal chunkSetId segment", async () => {
    await expect(
      saveOverlayChunkSet({ storeRoot, chunkSet: makeOverlayChunkSet({ chunkSetId: "../x" }) }),
    ).rejects.toBeInstanceOf(ContentStoreError);
  });

  it("isolates two workspaceKeys", async () => {
    await saveOverlayChunkSet({ storeRoot, chunkSet: makeOverlayChunkSet() });
    await expect(
      loadOverlayChunkSet({
        storeRoot,
        workspaceKey: "fedcba9876543210",
        liveSessionId: LSID,
        chunkSetId: "cs-1",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
