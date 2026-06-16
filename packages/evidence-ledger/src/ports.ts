// The ledger never imports @megasaver/content-store. Raw-chunk deletion is
// injected by the composer (core/context-gate), wired to content-store.deleteChunkSet.
// Best-effort: a missing chunk is not an error.
export type ChunkDeletePort = (chunkSetId: string) => Promise<void>;
