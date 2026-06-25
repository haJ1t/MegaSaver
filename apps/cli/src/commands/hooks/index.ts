import { defineCommand } from "citty";
import { hooksInstallCommand } from "./install.js";
import { hooksLogCommand } from "./log.js";
import { hooksIntentCommand } from "./intent.js";
import { hooksSaverCommand } from "./saver.js";
import { hooksStatusCommand } from "./status.js";
import { hooksUninstallCommand } from "./uninstall.js";

export { type RunHooksInstallInput, runHooksInstall, hooksInstallCommand } from "./install.js";
export {
  type RunHooksUninstallInput,
  runHooksUninstall,
  hooksUninstallCommand,
} from "./uninstall.js";
export { type RunHooksStatusInput, runHooksStatus, hooksStatusCommand } from "./status.js";
export { resolveClaudeCodeSettingsPath } from "./settings-path.js";
export { hooksLogCommand } from "./log.js";
export { hooksSaverCommand } from "./saver.js";
export { hooksIntentCommand } from "./intent.js";

export const hooksCommand = defineCommand({
  meta: {
    name: "hooks",
    description: "Manage Claude Code telemetry hooks and view proxy adoption metrics.",
  },
  subCommands: {
    install: hooksInstallCommand,
    uninstall: hooksUninstallCommand,
    status: hooksStatusCommand,
    log: hooksLogCommand,
    saver: hooksSaverCommand,
    intent: hooksIntentCommand,
  },
});
