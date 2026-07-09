import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneOlderThan } from "@megasaver/content-store";
import { fetchChunk, recordAndFilterOverlayOutput } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-roundtrip-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

describe("C11 roundtrip: hook compression → mega output chunk recovery path", () => {
  it("recovers any line via its 40-line chunk (multi-chunk model, C12)", async () => {
    const raw = Array.from({ length: 3_000 }, (_, i) => `line ${i}: some build output text`).join(
      "\n",
    );
    const recorded = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      raw,
      sourceKind: "command",
      label: "pnpm verify",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(recorded.decision).toBe("compressed");
    // Chunk "0" is now the FIRST 40 lines, not the whole raw.
    const first = await fetchChunk({
      storeRoot: store,
      chunkSetId: recorded.chunkSetId as string,
      chunkId: "0",
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.chunk.startLine).toBe(1);
      expect(first.chunk.endLine).toBe(40);
      expect(first.chunk.text).toContain("line 0: some build output text");
      expect(first.chunk.text).not.toContain("line 2999");
    }
    // "line 2999" is the 3000th line → chunk floor((3000-1)/40) = 74.
    const last = await fetchChunk({
      storeRoot: store,
      chunkSetId: recorded.chunkSetId as string,
      chunkId: "74",
    });
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.chunk.text).toContain("line 2999");
  });

  it("C14: gc removes the overlay set and its recovery path goes cold", async () => {
    const recorded = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: encodeWorkspaceKey("/Users/x/proj"),
      liveSessionId: "11111111-1111-4111-8111-111111111111",
      raw: Array.from({ length: 3_000 }, (_, i) => `line ${i}: some build output text`).join("\n"),
      sourceKind: "command",
      label: "pnpm verify",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(recorded.decision).toBe("compressed");
    const before = await fetchChunk({
      storeRoot: store,
      chunkSetId: recorded.chunkSetId as string,
      chunkId: "0",
    });
    expect(before.ok).toBe(true);
    // Prune everything up to the future → the just-written set is removed.
    const { removed } = await pruneOlderThan({
      storeRoot: store,
      olderThan: new Date(Date.now() + 1000),
    });
    expect(removed).toBeGreaterThanOrEqual(1);
    const after = await fetchChunk({
      storeRoot: store,
      chunkSetId: recorded.chunkSetId as string,
      chunkId: "0",
    });
    expect(after).toEqual({ ok: false, reason: "chunk_set_not_found" });
  });
});
