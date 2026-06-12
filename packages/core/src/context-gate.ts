export {
  runOutputPipeline,
  type RunOutputInput,
  type RunOutputResult,
  runOutputExecCommand,
  type RunOutputExecInput,
  type RunOutputExecResult,
  type RunCommandSpawn,
  type ExecResult,
  fetchChunk,
  type FetchChunkResult,
  locateChunkSet,
  type LocatedChunkSet,
  resolveEffectiveSettings,
  runTwoGates,
  readAndFilter,
  persistChunkSet,
  defaultNow,
  defaultNewId,
  type EffectiveSettings,
  type GateResult,
  type PipelineEnv,
  type OrchestratorRegistry,
  type SessionView,
  type ProjectView,
} from "@megasaver/context-gate";
// Token-saver stats surface: the CLI reads session savings through core
// (§3c allow-list — apps/cli depends on core, never on @megasaver/stats
// directly; see apps/cli/test/dependency-graph.test.ts).
export {
  appendEvent,
  readSummary,
  StatsError,
  type AppendEventInput,
  type SessionTokenSaverStats,
  type StatsErrorCode,
  type StatsStore,
  type TokenSaverEvent,
} from "@megasaver/stats";

export {
  appendAuditEvent,
  type AppendAuditEventInput,
  readAuditEvents,
  summarizeAudit,
  type SummarizeAuditOptions,
  auditEventSchema,
  type AuditEvent,
  auditSummarySchema,
  type AuditSummary,
  auditWindowSchema,
  type AuditWindow,
  resolveAuditWindow,
} from "@megasaver/stats";
