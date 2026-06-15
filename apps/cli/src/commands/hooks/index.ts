import { defineCommand } from "citty";
import { hooksInstallCommand } from "./install.js";
import { hooksLogCommand } from "./log.js";
import { hooksSaverCommand } from "./saver.js";
import { hooksStatusCommand } from "./status.js";

export {
  type RunHooksInstallInput,
  runHooksInstall,
  installClaudeCodeHook,
  addPreToolUseHook,
  hasPreToolUseHook,
  addPostToolUseHook,
  hasPostToolUseHook,
  HOOK_MATCHER,
  DEFAULT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
  hooksInstallCommand,
} from "./install.js";
export { type RunHooksStatusInput, runHooksStatus, hooksStatusCommand } from "./status.js";
export { resolveClaudeCodeSettingsPath } from "./settings-path.js";
export { hooksLogCommand } from "./log.js";
export { hooksSaverCommand } from "./saver.js";

export const hooksCommand = defineCommand({
  meta: {
    name: "hooks",
    description: "Manage Claude Code telemetry hooks and view proxy adoption metrics.",
  },
  subCommands: {
    install: hooksInstallCommand,
    status: hooksStatusCommand,
    log: hooksLogCommand,
    saver: hooksSaverCommand,
  },
});
