import { type ClaudeCodeHookResult, installClaudeCodeHook } from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";

export type RunHooksInstallInput = {
  target: string;
  settingsPath: string;
  command?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export function runHooksInstall(input: RunHooksInstallInput): 0 | 1 {
  if (input.target !== "claude-code") {
    input.stderr(`error: unknown hook target "${input.target}" (supported: claude-code)`);
    return 1;
  }
  let result: ClaudeCodeHookResult;
  try {
    result = installClaudeCodeHook({
      settingsPath: input.settingsPath,
      ...(input.command !== undefined ? { command: input.command } : {}),
    });
  } catch (err) {
    input.stderr(
      `error: could not install Claude Code hook at ${input.settingsPath}: ${
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
        ? `Installed Claude Code Mega Saver hooks (PreToolUse telemetry + PostToolUse saver + UserPromptSubmit intent) at ${result.settingsPath}`
        : `Claude Code Mega Saver hooks already installed at ${result.settingsPath} (no-op)`,
    );
  }
  return 0;
}

export const hooksInstallCommand = defineCommand({
  meta: {
    name: "install",
    description: "Install the Claude Code Mega Saver hooks (telemetry + saver).",
  },
  args: {
    target: { type: "positional", required: true, description: "Hook target (claude-code)." },
    settings: { type: "string", description: "Override Claude Code settings.json path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  run({ args }) {
    const code = runHooksInstall({
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
