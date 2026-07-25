import { readdirSync } from "node:fs";
import { join } from "node:path";
import { deleteOverlayChunkSet } from "@megasaver/content-store";
import { gcEvidence } from "@megasaver/evidence-ledger";
import { locateChunkSet } from "./locate-chunk-set.js";

// Store-wide ordinary-retention pass over the evidence ledger: gcEvidence is
// per-workspace, so nothing swept dead workspaces (and nothing called it at
// all). Best-effort throughout — housekeeping, never correctness.
export async function sweepEvidenceStore(input: {
  storeRoot: string;
  now: Date;
}): Promise<{ degraded: number }> {
  let workspaceKeys: string[];
  try {
    workspaceKeys = readdirSync(join(input.storeRoot, "evidence"));
  } catch {
    return { degraded: 0 };
  }
  const deleteChunk = async (chunkSetId: string): Promise<void> => {
    const at = locateChunkSet({ storeRoot: input.storeRoot, chunkSetId });
    if (at?.layout !== "overlay") return;
    await deleteOverlayChunkSet({
      storeRoot: input.storeRoot,
      workspaceKey: at.workspaceKey,
      liveSessionId: at.liveSessionId,
      chunkSetId,
    });
  };
  let degraded = 0;
  for (const workspaceKey of workspaceKeys) {
    try {
      const res = await gcEvidence({
        storeRoot: input.storeRoot,
        workspaceKey,
        now: input.now,
        deleteChunk,
      });
      degraded += res.degraded;
    } catch {
      // A non-workspace dir or one corrupt record must not stop the sweep.
    }
  }
  return { degraded };
}
