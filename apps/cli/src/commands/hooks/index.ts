import { defineCommand } from "citty";
import { hooksCacheAdviceMaintainCommand } from "./cache-advice-maintain.js";
import { hooksCacheAdviceCommand } from "./cache-advice.js";
import { hooksCapsuleCommand } from "./capsule.js";
import { hooksExecRewriteCommand } from "./exec-rewrite.js";
import { hooksFailureScanCommand } from "./failure-scan.js";
import { hooksGuardCommand } from "./guard.js";
import { hooksInstallCommand } from "./install.js";
import { hooksIntentCommand } from "./intent.js";
import { hooksLogCommand } from "./log.js";
import { hooksMeshHintCommand } from "./mesh-hint.js";
import { hooksRecapCommand } from "./recap.js";
import { hooksSaverCommand } from "./saver.js";
import { hooksStatusCommand } from "./status.js";
import { hooksUninstallCommand } from "./uninstall.js";
import { hooksVerifyReminderCommand } from "./verify-reminder.js";
import { hooksWarmupCommand } from "./warmup.js";

export { type RunHooksInstallInput, runHooksInstall, hooksInstallCommand } from "./install.js";
export {
  type RunHooksUninstallInput,
  runHooksUninstall,
  hooksUninstallCommand,
} from "./uninstall.js";
export { type RunHooksStatusInput, runHooksStatus, hooksStatusCommand } from "./status.js";
export { resolveClaudeCodeSettingsPath } from "./settings-path.js";
export { hooksCacheAdviceCommand } from "./cache-advice.js";
export { hooksCacheAdviceMaintainCommand } from "./cache-advice-maintain.js";
export { hooksCapsuleCommand } from "./capsule.js";
export { hooksLogCommand } from "./log.js";
export { hooksRecapCommand } from "./recap.js";
export { hooksSaverCommand } from "./saver.js";
export { hooksIntentCommand } from "./intent.js";
export { hooksGuardCommand } from "./guard.js";
export { hooksExecRewriteCommand } from "./exec-rewrite.js";
export { hooksWarmupCommand } from "./warmup.js";
export { hooksMeshHintCommand } from "./mesh-hint.js";

export const hooksCommand = defineCommand({
  meta: {
    name: "hooks",
    description: "Manage Claude Code telemetry hooks and view proxy adoption metrics.",
  },
  subCommands: {
    install: hooksInstallCommand,
    uninstall: hooksUninstallCommand,
    status: hooksStatusCommand,
    "cache-advice": hooksCacheAdviceCommand,
    "cache-advice-maintain": hooksCacheAdviceMaintainCommand,
    capsule: hooksCapsuleCommand,
    recap: hooksRecapCommand,
    log: hooksLogCommand,
    saver: hooksSaverCommand,
    intent: hooksIntentCommand,
    guard: hooksGuardCommand,
    "exec-rewrite": hooksExecRewriteCommand,
    "failure-scan": hooksFailureScanCommand,
    warmup: hooksWarmupCommand,
    "mesh-hint": hooksMeshHintCommand,
    "verify-reminder": hooksVerifyReminderCommand,
  },
});
