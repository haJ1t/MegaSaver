export { tokenSaverEventSchema, type TokenSaverEvent } from "./event.js";

export { sessionTokenSaverStatsSchema, type SessionTokenSaverStats } from "./summary.js";

export {
  appendEvent,
  type AppendEventInput,
  readEvents,
  readSummary,
  resetOnDisable,
  type StatsStore,
} from "./store.js";

export { StatsError, statsErrorCodeSchema, type StatsErrorCode } from "./errors.js";

export {
  type AdoptionMetrics,
  aggregateAdoption,
  type BuildProxyMetricsInput,
  buildProxyMetrics,
  computeInterception,
  HOOK_MISSING_HINT,
  type HookIngestResult,
  ingestHookLog,
  type InterceptionMetrics,
  type ProxyMetrics,
  type ProxyToolName,
  proxyToolNameForSourceKind,
} from "./metrics.js";
