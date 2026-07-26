import { readdirSync } from "node:fs";
import { join } from "node:path";
import { deleteOverlayChunkSet } from "@megasaver/content-store";
import { type ChunkRef, gcEvidence } from "@megasaver/evidence-ledger";
import { EVIDENCE_RETENTION_MS } from "./record-output.js";

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
  // Delete only at the record's own (workspaceKey, session, id) path. A ref
  // whose session scope is unresolvable is skipped rather than searched for:
  // the id alone matches colliding copies owned by other, live sessions.
  const deleteChunk = async (ref: ChunkRef): Promise<void> => {
    if (ref.sessionRef?.kind !== "live") return;
    await deleteOverlayChunkSet({
      storeRoot: input.storeRoot,
      workspaceKey: ref.workspaceKey,
      liveSessionId: ref.sessionRef.id,
      chunkSetId: ref.chunkSetId,
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
        // Records the saver wrote before it stamped expiresAt carry null; they
        // age out on the same 30-day clock as everything else it wrote.
        fallbackExpiryMs: EVIDENCE_RETENTION_MS,
      });
      degraded += res.degraded;
    } catch {
      // A non-workspace dir or one corrupt record must not stop the sweep.
    }
  }
  return { degraded };
}
