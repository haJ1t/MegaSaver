export { rankFeatureNameSchema, type RankFeatureName } from "./rank-features.js";
export { outputSourceKindSchema, type OutputSourceKind } from "./output-source.js";
export {
  CLASSIFICATION_CONFIDENCE_FLOOR,
  classifyOutput,
  isConfidentClassification,
  outputCategorySchema,
  type Classification,
  type ClassifyInput,
  type OutputCategory,
} from "./classify.js";
export { compressByCategory, type CompressorName } from "./compress/index.js";
export {
  buildRankingTrace,
  finalizeReplayTrace,
  readReplayTraces,
  replayTraceSchema,
  writeReplayTrace,
  type ChunkRef,
  type RankingTrace,
  type ReplayTrace,
  type ReplayTraceMeta,
} from "./replay-trace.js";
export {
  readSessionDecisionTrace,
  type DecisionOutput,
  type RankedChunkView,
  type SessionDecisionTrace,
} from "./decision-trace.js";
export {
  estimateTokens,
  HARD_WRAP_THRESHOLD_TOKENS,
  PASSTHROUGH_THRESHOLD_TOKENS,
  type FilterDecision,
} from "./tokens.js";

export {
  filterOutput,
  filterOutputInputSchema,
  type FilterOutputInput,
  type FilterOutputResult,
  type OutputExcerpt,
} from "./types.js";

export {
  resolveSafeReadPath,
  type ResolveSafeReadPathInput,
  type ResolvedPath,
} from "./resolve-safe-read-path.js";

export {
  OutputFilterError,
  outputFilterErrorCodeSchema,
  type OutputFilterErrorCode,
} from "./errors.js";

export {
  applyEngineRanking,
  engineRankingDisabledByEnv,
  engineRankingFromEnv,
  resolveEngineRanking,
  resolveEngineRankingDisabled,
  resolveSeamTraceEnabled,
  seamTraceEnabledByEnv,
  type EngineScore,
  type RankFeatures,
  type RankedChunk,
  type SessionHints,
} from "./rank.js";
