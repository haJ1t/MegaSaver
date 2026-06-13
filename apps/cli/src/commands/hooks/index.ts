import { defineCommand } from "citty";
import { hooksInstallCommand } from "./install.js";
import { hooksLogCommand } from "./log.js";
import { hooksStatusCommand } from "./status.js";

export {
  type RunHooksInstallInput,
  runHooksInstall,
  installClaudeCodeHook,
  addPreToolUseHook,
  hasPreToolUseHook,
  HOOK_MATCHER,
  DEFAULT_HOOK_COMMAND,
  hooksInstallCommand,
} from "./install.js";
export { type RunHooksStatusInput, runHooksStatus, hooksStatusCommand } from "./status.js";
export { resolveClaudeCodeSettingsPath } from "./settings-path.js";
export { hooksLogCommand } from "./log.js";

export const hooksCommand = defineCommand({
  meta: {
    name: "hooks",
    description: "Manage Claude Code telemetry hooks and view proxy adoption metrics.",
  },
  subCommands: {
    install: hooksInstallCommand,
    status: hooksStatusCommand,
    log: hooksLogCommand,
  },
});
