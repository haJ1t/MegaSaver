import { defineCommand } from "citty";
import { brainAutopilotCommand } from "./autopilot.js";
import { brainDigestCommand } from "./digest.js";
import { brainExportCommand } from "./export.js";
import { brainImportCommand } from "./import.js";
import { brainSyncCommand } from "./sync/index.js";

export {
  AUTOPILOT_UPSELL,
  type RunAutopilotOffInput,
  type RunAutopilotOnInput,
  type RunAutopilotRunInput,
  type RunAutopilotStatusInput,
  brainAutopilotCommand,
  runAutopilotOff,
  runAutopilotOn,
  runAutopilotRun,
  runAutopilotStatus,
} from "./autopilot.js";
export {
  DIGEST_UPSELL,
  type RunBrainDigestInput,
  brainDigestCommand,
  runBrainDigest,
} from "./digest.js";
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
    autopilot: brainAutopilotCommand,
    digest: brainDigestCommand,
    export: brainExportCommand,
    import: brainImportCommand,
    sync: brainSyncCommand,
  },
});
