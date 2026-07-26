import type { WorkspaceKey } from "@megasaver/shared";
import type { SessionRef } from "./sub-schemas.js";

// A chunk file is addressed by (workspaceKey, session dir, chunkSetId). Saver
// chunk-set ids are sha256 of the raw output, so the id alone is NOT unique
// across sessions — a port taking the bare id let the composer delete whichever
// colliding copy a store-wide scan happened to see first.
export type ChunkRef = {
  workspaceKey: WorkspaceKey;
  sessionRef: SessionRef;
  chunkSetId: string;
};

// The ledger never imports @megasaver/content-store. Raw-chunk deletion is
// injected by the composer (core/context-gate), wired to content-store.deleteChunkSet.
// Best-effort: a missing chunk is not an error.
export type ChunkDeletePort = (ref: ChunkRef) => Promise<void>;
