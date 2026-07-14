import { defineCommand } from "citty";
import { brainExportCommand } from "./export.js";
import { brainImportCommand } from "./import.js";
import { brainSyncCommand } from "./sync/index.js";

export {
  BRAIN_EXPORT_UPSELL,
  type RunBrainExportInput,
  brainExportCommand,
  runBrainExport,
} from "./export.js";
export {
  BRAIN_IMPORT_UPSELL,
  type RunBrainImportInput,
  brainImportCommand,
  runBrainImport,
} from "./import.js";
export {
  type BrainSyncOpInput,
  brainSyncCommand,
  brainSyncPullCommand,
  brainSyncPushCommand,
  brainSyncStatusCommand,
  runBrainSyncPull,
  runBrainSyncPush,
  runBrainSyncStatus,
} from "./sync/index.js";

export const brainCommand = defineCommand({
  meta: {
    name: "brain",
    description: "Portable project brain — export/import the knowledge layer (Mega Saver Pro).",
  },
  subCommands: {
    export: brainExportCommand,
    import: brainImportCommand,
    sync: brainSyncCommand,
  },
});
