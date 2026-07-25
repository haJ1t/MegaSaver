import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pruneOlderThan } from "@megasaver/content-store";
import { listEvidenceByWorkspace } from "@megasaver/evidence-ledger";
import { workspaceKeySchema } from "@megasaver/shared";

// Evidence-ledger spec §5: ordinary retention GC skips `pinned` and
// `manual_hold`. The content-store prune walks chunk files by createdAt and
// cannot see the ledger (no dep edge in either direction), so the composer
// joins the two here. Without the join a pinned record survives GC still
// claiming `rawExpandable: true` over a chunk the same run deleted — the one
// record class the user explicitly protected loses its raw.
// ponytail: full ledger scan per prune run (daily, or on an explicit
// `mega output gc`); index held ids on pin/unpin if the ledger ever outgrows it.
async function heldChunkSetIds(storeRoot: string): Promise<ReadonlySet<string>> {
  const held = new Set<string>();
  let entries: string[];
  try {
    entries = readdirSync(join(storeRoot, "evidence"));
  } catch {
    return held;
  }
  for (const entry of entries) {
    if (!workspaceKeySchema.safeParse(entry).success) continue;
    // Deliberately unguarded: a corrupt ledger must abort the prune rather than
    // let it delete held chunks blind. Both callers already handle a throw.
    for (const rec of await listEvidenceByWorkspace({ storeRoot, workspaceKey: entry })) {
      if (rec.status !== "available") continue;
      if (rec.retentionClass !== "pinned" && rec.retentionClass !== "manual_hold") continue;
      if (rec.redactedRawChunkSetId !== null) held.add(rec.redactedRawChunkSetId);
    }
  }
  return held;
}

export async function pruneChunkSetsHonoringPins(input: {
  storeRoot: string;
  olderThan: Date;
}): Promise<{ removed: number }> {
  return pruneOlderThan({
    storeRoot: input.storeRoot,
    olderThan: input.olderThan,
    keepChunkSetIds: await heldChunkSetIds(input.storeRoot),
  });
}
