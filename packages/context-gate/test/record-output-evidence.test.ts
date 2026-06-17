import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteOverlayChunkSet } from "@megasaver/content-store";
import { listEvidenceByWorkspace, revokeEvidence } from "@megasaver/evidence-ledger";
import { describe, expect, it } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const SID = "live-sess-ev";

function store(): string {
  return mkdtempSync(join(tmpdir(), "ms-ev-"));
}

// Large enough to compress under aggressive mode
const bigRaw = `line ${"x".repeat(40)}\n`.repeat(2000);

describe("recordAndFilterOverlayOutput — evidence write", () => {
  it("appends one evidence row referencing the chunkSetId when decision===compressed and evidenceStoreRoot is set", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      evidenceStoreRoot: storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw,
      sourceKind: "command",
      label: "ls -la",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.decision).toBe("compressed");
    expect(res.chunkSetId).toBeTypeOf("string");

    const records = await listEvidenceByWorkspace({ storeRoot, workspaceKey: WK });
    expect(records).toHaveLength(1);
    expect(records[0]?.redactedRawChunkSetId).toBe(res.chunkSetId);
    expect(records[0]?.sessionRef).toEqual({ kind: "live", id: SID });
    expect(records[0]?.sourceKind).toBe("command");
    expect(records[0]?.status).toBe("available");
  });

  it("writes no evidence row when evidenceStoreRoot is absent", async () => {
    const storeRoot = store();
    await recordAndFilterOverlayOutput({
      storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw,
      sourceKind: "file",
      label: "/etc/hosts",
      mode: "aggressive",
      storeRawOutput: true,
    });

    const records = await listEvidenceByWorkspace({ storeRoot, workspaceKey: WK });
    expect(records).toHaveLength(0);
  });

  it("deleteOverlayChunkSet port purges the chunk on revoke", async () => {
    const storeRoot = store();
    const res = await recordAndFilterOverlayOutput({
      storeRoot,
      evidenceStoreRoot: storeRoot,
      workspaceKey: WK,
      liveSessionId: SID,
      raw: bigRaw,
      sourceKind: "command",
      label: "cat big.txt",
      mode: "aggressive",
      storeRawOutput: true,
    });

    const records = await listEvidenceByWorkspace({ storeRoot, workspaceKey: WK });
    const firstRecord = records[0];
    expect(firstRecord).toBeDefined();
    const evidenceId = firstRecord?.evidenceId ?? "";
    const chunkSetId = res.chunkSetId ?? "";
    const chunkPath = join(storeRoot, "content", WK, SID, `${chunkSetId}.json`);
    expect(existsSync(chunkPath)).toBe(true);

    // The deleteChunk port closed over the same path components used at write time.
    const deleteChunk = (id: string): Promise<void> =>
      deleteOverlayChunkSet({ storeRoot, workspaceKey: WK, liveSessionId: SID, chunkSetId: id });

    await revokeEvidence({
      storeRoot,
      workspaceKey: WK,
      evidenceId,
      reason: "user_requested_purge",
      deleteChunk,
      now: new Date(),
    });

    expect(existsSync(chunkPath)).toBe(false);
  });
});
