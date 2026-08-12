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
  handoffOfferPointerSchema,
  type HandoffOfferPointer,
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
export { sendMessage, drainInbox } from "./inbox.js";
export { claimPaths, checkConflicts, releaseClaim } from "./claims.js";
export { postFact, readBoardFacts, resolveFact } from "./board/store.js";
export {
  BOARD_DELTA_CHECK_INTERVAL_MS,
  BOARD_INJECT_MAX_TOKENS,
  formatBoardFacts,
  normalizeTopic,
  selectBoardDigest,
  selectFactsForInjection,
} from "./board/index.js";
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
export {
  ASK_MIN_INTERVAL_MS,
  askPayloadSchema,
  type AskPayload,
  answerEvidenceSchema,
  type AnswerEvidence,
  answerPayloadSchema,
  type AnswerPayload,
} from "./qa.js";
export {
  askStateFilePath,
  checkAskRateLimit,
  recordAskPosted,
  postAsk,
  type AskRateVerdict,
  type PostAskDeps,
  type PostAskResult,
} from "./ask.js";
export {
  HINT_EVENT_WINDOW_MS,
  HINT_MAX_EVENTS,
  HINT_MIN_SHARED_KEYWORDS,
  HINT_MAX_CHARS,
  extractKeywords,
  matchPeerAnswer,
  renderPeerAnswerHint,
  type PeerAnswerCandidate,
} from "./hint.js";
