import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOverlayChunkSet } from "@megasaver/content-store";
import { readOverlayEvents, readOverlaySummary } from "@megasaver/stats";
import { afterEach, describe, expect, it } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const SID = "live-sess-1";

let root: string;
afterEach(() => {
  root = "";
});

function store(): string {
  root = mkdtempSync(join(tmpdir(), "ms-record-"));
  return root;
}

describe("recordAndFilterOverlayOutput", () => {
  it("compresses a large buffer, records an overlay event keyed by (wk, liveSessionId), stores a recoverable chunk", async () => {
    const storeRoot = store();
    const raw = `line ${"x".repeat(40)}\n`.repeat(2000);
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo big",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");
    expect(res.returnedBytes).toBeLessThan(res.rawBytes);
    expect(res.bytesSaved).toBeGreaterThan(0);
    expect(res.chunkSetId).toBeTypeOf("string");

    const summary = readOverlaySummary({ root: storeRoot }, WK, SID);
    expect(summary?.eventsTotal).toBe(1);
    expect(summary?.bytesSavedTotal).toBe(res.bytesSaved);
    const events = readOverlayEvents({ root: storeRoot }, WK, SID);
    expect(events).toHaveLength(1);
    expect(events[0]?.liveSessionId).toBe(SID);
    expect(events[0]?.workspaceKey).toBe(WK);
    expect(events[0]?.sourceKind).toBe("command");

    const chunkPath = join(storeRoot, "content", WK, SID, `${res.chunkSetId}.json`);
    const chunk = JSON.parse(readFileSync(chunkPath, "utf8"));
    expect(chunk.chunks.length).toBeGreaterThan(0);
  });

  it("passes through (no event, no chunk) when output is below the mode budget", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: "small output\n",
      sourceKind: "command",
      label: "echo small",
      mode: "safe",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("passthrough");
    expect(res.chunkSetId).toBeUndefined();
    expect(readOverlaySummary({ root: storeRoot }, WK, SID)).toBeNull();
  });

  it("stores the FULL output (lossless): a marker buried in the middle is recoverable via expand", async () => {
    const storeRoot = store();
    const raw = `${"filler line\n".repeat(3000)}UNIQUE_MIDDLE_MARKER_9f3a\n${"filler line\n".repeat(3000)}`;
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo middle",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const full = cs.chunks.map((c) => c.text).join("\n");
    expect(full).toContain("UNIQUE_MIDDLE_MARKER_9f3a");
    // Full output, not just the budget-fitted excerpts: the stored bytes far
    // exceed what was returned to the model, and the whole raw round-trips.
    expect(full).toBe(raw);
    expect(Buffer.byteLength(full, "utf8")).toBeGreaterThan(res.returnedBytes);
  });

  it("redacts secrets in the stored chunk and counts them in the summary", async () => {
    const storeRoot = store();
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const raw = `${"filler line\n".repeat(3000)}${secret}\n${"filler line\n".repeat(3000)}`;
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw,
      sourceKind: "command",
      label: "echo secret",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");

    const summary = readOverlaySummary({ root: storeRoot }, WK, SID);
    expect(summary?.secretsRedactedTotal).toBeGreaterThan(0);

    const cs = await loadOverlayChunkSet({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      // biome-ignore lint/style/noNonNullAssertion: decision === "compressed" guarantees chunkSetId
      chunkSetId: res.chunkSetId!,
    });
    const full = cs.chunks.map((c) => c.text).join("\n");
    expect(full).not.toContain(secret);
    expect(cs.redacted).toBe(true);
  });
});
