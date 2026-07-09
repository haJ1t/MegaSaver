import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchChunk, recordAndFilterOverlayOutput } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-roundtrip-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

describe("C11 roundtrip: hook compression → mega output chunk recovery path", () => {
  it("fetchChunk returns the full raw for a hook-written overlay set", async () => {
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
    const out = await fetchChunk({
      storeRoot: store,
      chunkSetId: recorded.chunkSetId as string,
      chunkId: "0",
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.chunk.text).toContain("line 2999");
  });
});
