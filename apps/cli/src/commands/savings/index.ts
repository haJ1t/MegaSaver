import { defineCommand } from "citty";
import { savingsExportCommand } from "./export.js";
import { savingsHistoryCommand } from "./history.js";

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
  type SavingsEventReader,
  type SavingsSnapshot,
  PRO_ANALYTICS_UPSELL,
  PRO_ANALYTICS_URL,
  defaultSavingsEventReader,
} from "./shared.js";

export const savingsCommand = defineCommand({
  meta: {
    name: "savings",
    description: "Mega Saver Pro: historical savings analytics and export.",
  },
  subCommands: {
    history: savingsHistoryCommand,
    export: savingsExportCommand,
  },
});
