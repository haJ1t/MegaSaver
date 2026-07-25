import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gcEvidence, listEvidenceByWorkspace } from "@megasaver/evidence-ledger";
import { describe, expect, it } from "vitest";
import { sweepEvidenceStore } from "../src/evidence-gc.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const WK = "0123456789abcdef";
const SID = "live-sess-gc";
const T0 = "2026-07-01T00:00:00.000Z";
const DAY_MS = 86_400_000;

function store(): string {
  return mkdtempSync(join(tmpdir(), "ms-ev-gc-"));
}

function evidenceBytes(storeRoot: string, workspaceKey = WK): number {
  const dir = join(storeRoot, "evidence", workspaceKey);
  let total = 0;
  for (const name of readdirSync(dir)) total += statSync(join(dir, name)).size;
  return total;
}

// One returnedChunkRef per 40-line chunk of the FULL raw output. Sized by chunk
// COUNT, not a magic byte number: 40k lines => ~1k refs, the disk term that
// grows with input size. A cheap-to-filter shape (short lines, no long
// delimiter-free runs) keeps the redaction pass off its quadratic patterns.
const manyLines = Array.from({ length: 40_000 }, (_, i) => `ln ${i}`).join("\n");

async function writeEvidence(storeRoot: string): Promise<string> {
  const res = await recordAndFilterOverlayOutput({
    storeRoot,
    evidenceStoreRoot: storeRoot,
    workspaceKey: WK,
    liveSessionId: SID,
    raw: manyLines,
    sourceKind: "command",
    label: "cat huge.log",
    mode: "aggressive",
    storeRawOutput: true,
    now: () => T0,
  });
  expect(res.decision).toBe("compressed");
  return join(storeRoot, "content", WK, SID, `${res.chunkSetId}.json`);
}

describe("saver evidence retention", () => {
  it("expires so ordinary GC collapses the per-chunk refs after the retention window", async () => {
    const storeRoot = store();
    await writeEvidence(storeRoot);

    const before = evidenceBytes(storeRoot);
    expect(before).toBeGreaterThan(50_000);

    const { degraded } = await gcEvidence({
      storeRoot,
      workspaceKey: WK,
      now: new Date(Date.parse(T0) + 31 * DAY_MS),
      deleteChunk: async () => {},
    });
    expect(degraded).toBe(1);

    const [rec] = await listEvidenceByWorkspace({ storeRoot, workspaceKey: WK });
    expect(rec?.status).toBe("retained_metadata_only");
    expect(rec?.returnedChunkRefs).toEqual([]);
    expect(evidenceBytes(storeRoot)).toBeLessThan(before / 10);
  });

  it("does not expire before the retention window", async () => {
    const storeRoot = store();
    await writeEvidence(storeRoot);

    const { degraded } = await gcEvidence({
      storeRoot,
      workspaceKey: WK,
      now: new Date(Date.parse(T0) + 29 * DAY_MS),
      deleteChunk: async () => {},
    });
    expect(degraded).toBe(0);
  });
});

describe("sweepEvidenceStore", () => {
  it("sweeps every workspace and deletes the chunk set the record pointed at", async () => {
    const storeRoot = store();
    const chunkPath = await writeEvidence(storeRoot);
    expect(existsSync(chunkPath)).toBe(true);

    const { degraded } = await sweepEvidenceStore({
      storeRoot,
      now: new Date(Date.parse(T0) + 31 * DAY_MS),
    });

    expect(degraded).toBe(1);
    expect(readdirSync(join(storeRoot, "evidence", WK))).toHaveLength(1);
    expect(existsSync(chunkPath)).toBe(false);
  });

  it("returns zero without throwing when the store has no evidence dir", async () => {
    expect(await sweepEvidenceStore({ storeRoot: store(), now: new Date() })).toEqual({
      degraded: 0,
    });
  });
});
