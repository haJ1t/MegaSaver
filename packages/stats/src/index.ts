export {
  tokenSaverEventSchema,
  type TokenSaverEvent,
  overlayTokenSaverEventSchema,
  type OverlayTokenSaverEvent,
} from "./event.js";

export {
  sessionTokenSaverStatsSchema,
  type SessionTokenSaverStats,
  overlaySessionTokenSaverStatsSchema,
  type OverlaySessionTokenSaverStats,
} from "./summary.js";

export {
  appendEvent,
  type AppendEventInput,
  readEvents,
  readSummary,
  resetOnDisable,
  type StatsStore,
  appendOverlayEvent,
  type AppendOverlayEventInput,
  readOverlayEvents,
  readOverlaySummary,
  resetOverlayOnDisable,
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

export {
  auditEventSchema,
  type AuditEvent,
  contextPackBuiltEventSchema,
  ruleAppliedEventSchema,
  failureAvoidedEventSchema,
  memoryRetrievedEventSchema,
  toolRouteEventSchema,
} from "./audit-event.js";

export {
  auditSummarySchema,
  type AuditSummary,
  auditWindowSchema,
  type AuditWindow,
  resolveAuditWindow,
  summarizeAudit,
  type SummarizeAuditOptions,
} from "./audit-summary.js";

export {
  appendAuditEvent,
  type AppendAuditEventInput,
  readAuditEvents,
} from "./audit-store.js";
