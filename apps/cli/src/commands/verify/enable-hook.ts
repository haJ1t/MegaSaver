import { existsSync, readFileSync } from "node:fs";
import {
  type HookCommandConfig,
  addStopHook,
  buildHookCommand,
  hasStopHook,
  removeStopHook,
  writeSettingsFile,
} from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { readStoreEnv } from "../../store.js";
import { resolveBakedStoreRoot, resolveInvokedCliPath } from "../hooks/install.js";
import { resolveClaudeCodeSettingsPath } from "../hooks/settings-path.js";

export function runVerifyHookToggle(input: {
  action: "enable" | "disable";
  settingsPath: string;
  command: string;
  json: boolean;
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
  input.stdout(input.json ? JSON.stringify({ settingsPath: input.settingsPath, status }) : status);
  return 0;
}

function reminderHookCommand(storeFlag: string | undefined): string {
  const cliPath = resolveInvokedCliPath(process.argv[1]);
  const storeRoot = resolveBakedStoreRoot(readStoreEnv(storeFlag));
  const config: HookCommandConfig = {
    ...(cliPath !== undefined ? { cliPath } : {}),
    ...(storeRoot !== undefined ? { storeRoot } : {}),
  };
  return buildHookCommand("verify-reminder", config);
}

const toggleArgs = {
  settings: { type: "string", description: "Override Claude Code settings.json path." },
  store: {
    type: "string",
    description: "Override store directory (baked into the hook command when non-default).",
  },
  json: { type: "boolean", default: false, description: "Emit JSON output." },
} as const;

export const verifyEnableHookCommand = defineCommand({
  meta: { name: "enable-hook", description: "Opt in to the Stop-hook receipt reminder." },
  args: toggleArgs,
  run({ args }) {
    const code = runVerifyHookToggle({
      action: "enable",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      command: reminderHookCommand(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const verifyDisableHookCommand = defineCommand({
  meta: { name: "disable-hook", description: "Remove the Stop-hook receipt reminder." },
  args: toggleArgs,
  run({ args }) {
    const code = runVerifyHookToggle({
      action: "disable",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      command: reminderHookCommand(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
