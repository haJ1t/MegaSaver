import {
  type OverlayChunkSet,
  deleteOverlayChunkSet,
  saveOverlayChunkSet,
} from "@megasaver/content-store";
import { ReviewPackError } from "./errors.js";

export type PersistDeps = {
  save: typeof saveOverlayChunkSet;
  remove: typeof deleteOverlayChunkSet;
};

export async function persistPack(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  createdAt: string;
  rangeLabel: string;
  sets: { diff: OverlayChunkSet; context: OverlayChunkSet; manifest: OverlayChunkSet };
  deps?: PersistDeps;
}): Promise<void> {
  const save = input.deps?.save ?? saveOverlayChunkSet;
  const remove = input.deps?.remove ?? deleteOverlayChunkSet;
  const savedIds: string[] = [];

  const setsToSave = [input.sets.diff, input.sets.context, input.sets.manifest];
  for (const set of setsToSave) {
    try {
      await save({ storeRoot: input.storeRoot, chunkSet: set });
      savedIds.push(set.chunkSetId);
    } catch (err) {
      for (const id of savedIds) {
        try {
          await remove({
            storeRoot: input.storeRoot,
            workspaceKey: input.workspaceKey,
            liveSessionId: input.liveSessionId,
            chunkSetId: id,
          });
        } catch {
          // best-effort cleanup
        }
      }
      throw new ReviewPackError(
        "store_write_failed",
        `failed to persist review pack chunk set ${set.chunkSetId}`,
        { cause: err },
      );
    }
  }
}
