import { existsSync, readFileSync } from "node:fs";
import {
  type HookCommandConfig,
  addStopHook,
  buildHookCommand,
  hasStopHook,
  removeStopHook,
  writeSettingsFile,
} from "@megasaver/connector-claude-code";
import { readStoreEnv } from "../../store.js";
import { resolveBakedStoreRoot, resolveInvokedCliPath } from "../hooks/install.js";
import { resolveClaudeCodeSettingsPath } from "../hooks/settings-path.js";

export function runFailuresHookToggle(input: {
  action: "enable" | "disable";
  settingsPath: string;
  command: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}): 0 | 1 {
  let settings: unknown = {};
  try {
    if (existsSync(input.settingsPath)) {
      settings = JSON.parse(readFileSync(input.settingsPath, "utf8"));
    }
  } catch (err) {
    input.stderr(
      `error: could not read ${input.settingsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  const installed = hasStopHook(settings, input.command);
  const status =
    input.action === "enable"
      ? installed
        ? "already enabled"
        : "enabled"
      : installed
        ? "disabled"
        : "not installed";
  try {
    if (input.action === "enable" && !installed) {
      writeSettingsFile(input.settingsPath, addStopHook(settings, input.command));
    } else if (input.action === "disable" && installed) {
      writeSettingsFile(input.settingsPath, removeStopHook(settings, input.command));
    }
  } catch (err) {
    input.stderr(
      `error: could not write ${input.settingsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  input.stdout(status);
  return 0;
}

export function failureScanHookCommand(storeFlag: string | undefined): string {
  const cliPath = resolveInvokedCliPath(process.argv[1]);
  const storeRoot = resolveBakedStoreRoot(readStoreEnv(storeFlag));
  const config: HookCommandConfig = {
    ...(cliPath !== undefined ? { cliPath } : {}),
    ...(storeRoot !== undefined ? { storeRoot } : {}),
  };
  return buildHookCommand("failure-scan", config);
}

export function defaultFailureScanSettingsPath(): string {
  return resolveClaudeCodeSettingsPath();
}
