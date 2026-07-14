import { defineCommand } from "citty";
import { savingsBudgetCommand } from "./budget.js";
import { savingsExportCommand } from "./export.js";
import { savingsFixCommand } from "./fix.js";
import { savingsForecastCommand } from "./forecast.js";
import { savingsHistoryCommand } from "./history.js";
import { savingsInsightsCommand } from "./insights.js";

export {
  type HistoryBy,
  type RunSavingsHistoryInput,
  runSavingsHistory,
  savingsHistoryCommand,
} from "./history.js";
export {
  type ExportFormat,
  type RunSavingsExportInput,
  runSavingsExport,
  savingsExportCommand,
} from "./export.js";
export {
  type InsightsBy,
  type RunSavingsInsightsInput,
  runSavingsInsights,
  savingsInsightsCommand,
} from "./insights.js";
export {
  type ForecastPeriodArg,
  type ParsedGoal,
  type RunSavingsForecastInput,
  parseGoal,
  runSavingsForecast,
  savingsForecastCommand,
} from "./forecast.js";
export {
  type CodeTruthTotals,
  type CodeTruthTotalsReader,
  type GuardTotals,
  type GuardTotalsReader,
  type SavingsEventReader,
  type SavingsSnapshot,
  type WarmStartTotals,
  type WarmStartTotalsReader,
  PRO_ANALYTICS_UPSELL,
  PRO_ANALYTICS_URL,
  defaultCodeTruthTotalsReader,
  defaultGuardTotalsReader,
  defaultSavingsEventReader,
  defaultWarmStartTotalsReader,
  formatCodeTruthLine,
  formatGuardLine,
  formatWarmStartLine,
} from "./shared.js";
export {
  type FixMemoryFileReader,
  type FixSaverReader,
  type FixSaverWriter,
  type RunSavingsFixInput,
  FIX_UPSELL,
  defaultMemoryFileReader,
  defaultSaverReader,
  defaultSaverWriter,
  runSavingsFix,
  savingsFixCommand,
} from "./fix.js";
export {
  type RunBudgetClearInput,
  type RunBudgetSetInput,
  type RunBudgetShowInput,
  runBudgetClear,
  runBudgetSet,
  runBudgetShow,
  savingsBudgetCommand,
} from "./budget.js";

export const savingsCommand = defineCommand({
  meta: {
    name: "savings",
    description: "Mega Saver Pro: historical savings analytics and export.",
  },
  subCommands: {
    history: savingsHistoryCommand,
    export: savingsExportCommand,
    insights: savingsInsightsCommand,
    forecast: savingsForecastCommand,
    fix: savingsFixCommand,
    budget: savingsBudgetCommand,
  },
});
