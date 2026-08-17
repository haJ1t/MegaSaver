import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPSULE_FILENAME,
  listOverlayChunkSets,
  saveOverlayChunkSet,
} from "../src/index.js";

let storeRoot: string;
const wk = "wk-alpha";
const sid = "sess-1";

function overlaySet(
  chunkSetId: string,
  source: Parameters<typeof saveOverlayChunkSet>[0]["chunkSet"]["source"],
) {
  return {
    chunkSetId,
    liveSessionId: sid,
    workspaceKey: wk,
    createdAt: "2026-08-06T10:00:00.000Z",
    source,
    rawBytes: 5,
    redacted: true,
    chunks: [{ id: "c0", startLine: 0, endLine: 1, bytes: 5, text: "hello" }],
  };
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "overlay-list-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("listOverlayChunkSets", () => {
  it("returns [] for a session dir that does not exist", async () => {
    await expect(
      listOverlayChunkSets({ storeRoot, workspaceKey: wk, liveSessionId: "nope" }),
    ).resolves.toEqual([]);
  });

  it("summarizes persisted overlay chunk-sets with their source", async () => {
    await saveOverlayChunkSet({
      storeRoot,
      chunkSet: overlaySet("cs-file", { kind: "file", path: "src/a.ts" }),
    });
    await saveOverlayChunkSet({
      storeRoot,
      chunkSet: overlaySet("cs-cmd", {
        kind: "command",
        command: "pnpm test",
        args: [],
      }),
    });
    const summaries = await listOverlayChunkSets({
      storeRoot,
      workspaceKey: wk,
      liveSessionId: sid,
    });
    expect(summaries.map((s) => s.chunkSetId).sort()).toEqual(["cs-cmd", "cs-file"]);
    expect(summaries.find((s) => s.chunkSetId === "cs-file")?.source).toEqual({
      kind: "file",
      path: "src/a.ts",
    });
    expect(summaries.every((s) => s.redacted)).toBe(true);
  });

  it("skips the reserved capsule sibling and both index siblings", async () => {
    await saveOverlayChunkSet({
      storeRoot,
      chunkSet: overlaySet("cs-1", { kind: "file", path: "src/a.ts" }),
    });
    const dir = join(storeRoot, "content", wk, sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CAPSULE_FILENAME), `${JSON.stringify({ version: 1 })}\n`);
    writeFileSync(join(dir, "read-index.json"), "{}\n");
    writeFileSync(join(dir, "shown-index.json"), "{}\n");
    const summaries = await listOverlayChunkSets({
      storeRoot,
      workspaceKey: wk,
      liveSessionId: sid,
    });
    expect(summaries.map((s) => s.chunkSetId)).toEqual(["cs-1"]);
  });
});
