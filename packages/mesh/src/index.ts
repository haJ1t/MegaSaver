export {
  boardConfidenceSchema,
  type BoardConfidence,
  boardFactIdSchema,
  type BoardFactId,
  boardFactSchema,
  type BoardFact,
  boardFactStatusSchema,
  type BoardFactStatus,
  claimRecordSchema,
  type ClaimRecord,
  meshEventKindSchema,
  type MeshEventKind,
  meshEventSchema,
  type MeshEvent,
  meshStatusSchema,
  type MeshStatus,
  presenceRecordSchema,
  type PresenceRecord,
} from "./types.js";

export { meshPaths } from "./paths.js";

export { registerSession, heartbeat, listPeers } from "./presence.js";
export { postEvent, readEvents } from "./events.js";
export { gc } from "./gc.js";
export {
  STALE_AFTER_MS,
  DEAD_AFTER_MS,
  CLAIM_TTL_MS,
  HEARTBEAT_DEBOUNCE_MS,
  EVENTS_MAX_BYTES,
  EVENTS_MAX_AGE_MS,
  atomicWriteFileSync,
  quarantineFileSync,
  readJsonOrQuarantine,
  safeJsonParse,
} from "./store.js";
