import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defineCommand } from "citty";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";

// Proxy Mode v1.2 §13.2 — Claude Code PreToolUse telemetry hook installer.
// The hook logs metadata-only records for the five native tools so MegaSaver
// can compute the hook-based interception rate (§7.2-B). The hook is opt-in:
// installing it is the user's choice; it always exits 0 and never blocks the
// agent.

// §13.3: the native tools the PreToolUse hook observes. A Claude Code matcher
// is a regex over tool names.
export const HOOK_MATCHER = "Read|Bash|Grep|Glob|LS";

// The logger entry point. Claude Code runs this as a shell command, piping the
// PreToolUse payload to its stdin.
export const DEFAULT_HOOK_COMMAND = "mega hooks log";

type CommandHook = { type: "command"; command: string };
type PreToolUseEntry = { matcher?: string; hooks?: CommandHook[] };
// Named `hooks` property (so dot access satisfies both TS and Biome) plus an
// index signature so unrelated user keys (model, permissions, …) are preserved.
type SettingsObject = {
  hooks?: { PreToolUse?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};

function asSettings(value: unknown): SettingsObject {
  return typeof value === "object" && value !== null ? { ...(value as SettingsObject) } : {};
}

function entryReferencesCommand(entry: unknown, command: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as PreToolUseEntry).hooks;
  return Array.isArray(hooks) && hooks.some((h) => h?.command === command);
}

export function hasPreToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryReferencesCommand(e, command));
}

// Pure, idempotent merge. Returns a new settings object with the MegaSaver
// PreToolUse matcher added, preserving every unrelated key and any other
// PreToolUse / PostToolUse entries. Re-adding the same command is a no-op.
export function addPreToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  if (hasPreToolUseHook(next, command)) return next;

  const hooks = next.hooks ? { ...next.hooks } : {};
  const existingPre = hooks.PreToolUse;
  const pre = Array.isArray(existingPre) ? [...(existingPre as PreToolUseEntry[])] : [];
  pre.push({ matcher: HOOK_MATCHER, hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}

export type InstallClaudeCodeHookInput = {
  settingsPath: string;
  command?: string;
};

export type InstallClaudeCodeHookResult = {
  settingsPath: string;
  changed: boolean;
};

function readSettings(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8"));
}

export function installClaudeCodeHook(
  input: InstallClaudeCodeHookInput,
): InstallClaudeCodeHookResult {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  const existing = readSettings(input.settingsPath);
  if (hasPreToolUseHook(existing, command)) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  const next = addPreToolUseHook(existing, command);
  mkdirSync(dirname(input.settingsPath), { recursive: true });
  writeFileSync(input.settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  return { settingsPath: input.settingsPath, changed: true };
}

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
  let result: InstallClaudeCodeHookResult;
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
        ? `Installed Claude Code PreToolUse telemetry hook at ${result.settingsPath}`
        : `Claude Code telemetry hook already installed at ${result.settingsPath} (no-op)`,
    );
  }
  return 0;
}

export const hooksInstallCommand = defineCommand({
  meta: {
    name: "install",
    description: "Install the Claude Code PreToolUse telemetry hook.",
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
