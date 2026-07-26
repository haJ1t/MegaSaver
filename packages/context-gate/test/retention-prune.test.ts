import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvidence,
  explainEvidence,
  listEvidenceByWorkspace,
  pinEvidence,
} from "@megasaver/evidence-ledger";
import { memoryEntryIdSchema, workspaceKeySchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import { pruneChunkSetsHonoringPins } from "../src/retention-prune.js";

const WK = "0123456789abcdef";
const WK_B = "fedcba9876543210";
const SID = "live-sess-gc";
const MEM_ID = memoryEntryIdSchema.parse("00000000-0000-4000-8000-0000000000a1");
const BIG_RAW = `line ${"x".repeat(40)}\n`.repeat(2000);
const DAY_31 = new Date(Date.now() + 31 * 86_400_000);

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "ms-retention-"));
});
afterEach(() => rmSync(storeRoot, { recursive: true, force: true }));

async function recordOutput(
  label: string,
  opts: { workspaceKey?: string; contentId?: boolean } = {},
): Promise<{ chunkSetId: string; chunkPath: string; evidenceId: string }> {
  const workspaceKey = opts.workspaceKey ?? WK;
  const res = await recordAndFilterOverlayOutput({
    storeRoot,
    evidenceStoreRoot: storeRoot,
    workspaceKey,
    liveSessionId: SID,
    raw: BIG_RAW,
    sourceKind: "command",
    label,
    mode: "aggressive",
    storeRawOutput: true,
    // apps/cli/src/hooks/saver.ts:350 — content-derived, unsalted by session.
    ...(opts.contentId === true
      ? { newId: () => `cs-${createHash("sha256").update(BIG_RAW).digest("hex").slice(0, 32)}` }
      : {}),
  });
  const chunkSetId = res.chunkSetId ?? "";
  const records = await listEvidenceByWorkspace({ storeRoot, workspaceKey });
  const record = records.find((rec) => rec.redactedRawChunkSetId === chunkSetId);
  return {
    chunkSetId,
    chunkPath: join(storeRoot, "content", workspaceKey, SID, `${chunkSetId}.json`),
    evidenceId: record?.evidenceId ?? "",
  };
}

describe("pruneChunkSetsHonoringPins", () => {
  it("keeps the raw chunk a pinned record points at, so rawExpandable stays honest", async () => {
    const { chunkPath, evidenceId } = await recordOutput("cat pinned.txt");
    await pinEvidence({ storeRoot, workspaceKey: WK, evidenceId, memoryId: MEM_ID });

    await pruneChunkSetsHonoringPins({ storeRoot, olderThan: DAY_31 });

    const explained = await explainEvidence({ storeRoot, workspaceKey: WK, evidenceId });
    expect(explained.rawExpandable).toBe(true);
    expect(existsSync(chunkPath)).toBe(true);
  });

  it("still prunes an expired chunk no exempt record holds", async () => {
    const { chunkPath } = await recordOutput("cat unpinned.txt");

    const { removed } = await pruneChunkSetsHonoringPins({ storeRoot, olderThan: DAY_31 });

    expect(removed).toBe(1);
    expect(existsSync(chunkPath)).toBe(false);
  });

  it("keeps the raw chunk a manual_hold record points at", async () => {
    const { chunkSetId, chunkPath } = await recordOutput("cat held.txt");
    await appendEvidence({
      storeRoot,
      redactSourceRef: (ref) => ref,
      record: {
        evidenceId: randomUUID(),
        workspaceKey: workspaceKeySchema.parse(WK),
        sessionRef: { kind: "live", id: SID },
        sourceKind: "command",
        sourceRef: { command: "cat", args: ["held.txt"] },
        classification: "generic_shell",
        redactionReport: { redacted: false, highRiskFindings: 0, unresolvedHighRisk: false },
        redactedRawContent: "raw",
        redactedReturnedContent: "returned",
        redactedRawChunkSetId: chunkSetId,
        returnedChunkRefs: [{ chunkSetId, chunkId: "0" }],
        createdAt: new Date().toISOString(),
        expiresAt: null,
        retentionClass: "manual_hold",
        policyVersion: "1",
        pipelineVersion: "1",
      },
    });

    await pruneChunkSetsHonoringPins({ storeRoot, olderThan: DAY_31 });

    expect(existsSync(chunkPath)).toBe(true);
  });

  // Saver ids are sha256 of the raw output: two workspaces that ran the same
  // command hold the same id. A hold keyed by the bare id let one repo's pin
  // retain another repo's expired chunk, so that store never shrank.
  it("a pin in one workspace does not retain another workspace's expired chunk", async () => {
    const pinned = await recordOutput("cat shared.txt", { workspaceKey: WK_B, contentId: true });
    const expired = await recordOutput("cat shared.txt", { contentId: true });
    expect(pinned.chunkSetId).toBe(expired.chunkSetId);
    await pinEvidence({
      storeRoot,
      workspaceKey: WK_B,
      evidenceId: pinned.evidenceId,
      memoryId: MEM_ID,
    });

    await pruneChunkSetsHonoringPins({ storeRoot, olderThan: DAY_31 });

    expect(existsSync(pinned.chunkPath)).toBe(true);
    expect(existsSync(expired.chunkPath)).toBe(false);
  });
});
