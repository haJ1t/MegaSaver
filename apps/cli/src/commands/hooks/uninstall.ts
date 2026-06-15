import {
  type ClaudeCodeHookResult,
  uninstallClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";

export type RunHooksUninstallInput = {
  target: string;
  settingsPath: string;
  command?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export function runHooksUninstall(input: RunHooksUninstallInput): 0 | 1 {
  if (input.target !== "claude-code") {
    input.stderr(`error: unknown hook target "${input.target}" (supported: claude-code)`);
    return 1;
  }
  let result: ClaudeCodeHookResult;
  try {
    result = uninstallClaudeCodeHook({
      settingsPath: input.settingsPath,
      ...(input.command !== undefined ? { command: input.command } : {}),
    });
  } catch (err) {
    input.stderr(
      `error: could not uninstall Claude Code hook at ${input.settingsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  if (input.json) {
    input.stdout(JSON.stringify({ target: input.target, ...result }));
  } else {
    input.stdout(
      result.changed
        ? `Removed Claude Code Mega Saver hooks at ${result.settingsPath}`
        : `No Claude Code Mega Saver hooks found at ${result.settingsPath} (no-op)`,
    );
  }
  return 0;
}

export const hooksUninstallCommand = defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove the Claude Code Mega Saver hooks (telemetry + saver).",
  },
  args: {
    target: { type: "positional", required: true, description: "Hook target (claude-code)." },
    settings: { type: "string", description: "Override Claude Code settings.json path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  run({ args }) {
    const code = runHooksUninstall({
      target: typeof args.target === "string" ? args.target : "",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
