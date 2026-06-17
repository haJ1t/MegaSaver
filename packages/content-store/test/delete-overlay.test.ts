import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteOverlayChunkSet, saveOverlayChunkSet } from "../src/store.js";

describe("deleteOverlayChunkSet", () => {
  it("removes the file and does not throw if already absent (idempotent)", async () => {
    const root = mkdtempSync(join(tmpdir(), "cs-del-"));
    const chunkSet = {
      chunkSetId: "cs-1",
      workspaceKey: "0123456789abcdef",
      liveSessionId: "sid1",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: { kind: "command" as const, command: "ls", args: [] },
      rawBytes: 100,
      redacted: false,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 3, text: "hi\n" }],
    };

    await saveOverlayChunkSet({ storeRoot: root, chunkSet });
    const path = join(root, "content", "0123456789abcdef", "sid1", "cs-1.json");
    expect(existsSync(path)).toBe(true);

    await deleteOverlayChunkSet({
      storeRoot: root,
      workspaceKey: "0123456789abcdef",
      liveSessionId: "sid1",
      chunkSetId: "cs-1",
    });
    expect(existsSync(path)).toBe(false);

    // idempotent — no throw on second call
    await expect(
      deleteOverlayChunkSet({
        storeRoot: root,
        workspaceKey: "0123456789abcdef",
        liveSessionId: "sid1",
        chunkSetId: "cs-1",
      }),
    ).resolves.toBeUndefined();
  });
});
