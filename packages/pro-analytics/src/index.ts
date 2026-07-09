export {
  type BucketGranularity,
  type HistoryPoint,
  type ProjectRow,
  computeSavingsHistory,
  computeSavingsByProject,
} from "./history.js";
export { type ExportFormat, type SavingsRow, exportSavings } from "./export.js";
export {
  type WasteBy,
  type WasteRow,
  type WasteHeadline,
  computeWasteBreakdown,
  computeWasteHeadline,
} from "./insights.js";
export {
  type ForecastPeriod,
  type SavingsForecast,
  type BudgetGoal,
  type BudgetPace,
  forecastSavings,
  budgetPace,
} from "./forecast.js";
export { type RoiReport, PRO_PRICE_USD_PER_MONTH, computeRoi } from "./roi.js";
export {
  type FixAction,
  type FixActionKind,
  type FixMemoryFile,
  type FixPlan,
  type FixSaverState,
  FIX_CHATTY_RATIO,
  FIX_CHATTY_SHARE,
  FIX_MEMORY_FILE_BYTES,
  FIX_MIN_EVENTS,
  FIX_READ_SHARE,
  FIX_WEAK_MIN_TOKENS,
  FIX_WEAK_RATIO,
  computeFixPlan,
} from "./fix.js";
export {
  type TeardownAdvice,
  type TeardownCulprit,
  type TeardownReport,
  composeTeardown,
  renderTeardownCardSvg,
  renderTeardownMarkdown,
} from "./teardown.js";
export {
  type BenchParity,
  type BenchPass,
  type BenchReport,
  composeBenchReport,
  renderBenchMarkdown,
} from "./bench.js";
export {
  type CompressionReport,
  composeCompressionReport,
  renderCompressionSummary,
} from "./compress-file.js";
export {
  type CacheDetector,
  type CacheDoctorReport,
  type CacheFinding,
  type CacheUsageEvent,
  CACHE_ADVICE,
  CACHE_TTL_MS,
  MIN_CACHEABLE_TOKENS,
  diagnoseCache,
} from "./cache-doctor.js";
export {
  diagnoseFirewall,
  FIREWALL_ADVICE,
  type FirewallEventInput,
  type FirewallReport,
} from "./firewall-report.js";
// Re-export the input price so CLI consumers can render the "(est. at $N/M)"
// footnote without importing @megasaver/stats directly (that edge is forbidden
// for apps/cli; pro-analytics already depends on stats).
export { INPUT_PRICE_PER_MTOK_USD } from "@megasaver/stats";
