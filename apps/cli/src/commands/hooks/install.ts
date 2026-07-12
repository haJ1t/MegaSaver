import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  type ClaudeCodeHookResult,
  type HookCommandConfig,
  installClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { type ResolveStorePathInput, readStoreEnv, resolveStorePath } from "../../store.js";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";

export type RunHooksInstallInput = {
  target: string;
  settingsPath: string;
  command?: string;
  config?: HookCommandConfig;
  warmup?: boolean;
  guard?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

// E23: register the stable launcher path (argv[1]), not the versioned realpath
// target — the launcher symlink survives upgrades. Fall back to the bare form
// when the invoked path cannot be resolved (tests, REPL).
export function resolveInvokedCliPath(argv1: string | undefined): string | undefined {
  if (argv1 === undefined || argv1 === "") return undefined;
  if (isAbsolute(argv1)) return argv1;
  try {
    return realpathSync(argv1);
  } catch {
    return undefined;
  }
}

// E29: bake --store into the hook commands ONLY when the CLI's resolved store
// differs from what the same environment resolves without the flag (the
// default). Equal roots bake nothing, keeping default installs byte-stable.
export function resolveBakedStoreRoot(env: ResolveStorePathInput): string | undefined {
  try {
    const resolved = resolveStorePath(env);
    const dflt = resolveStorePath({ ...env, storeFlag: undefined });
    return resolved === dflt ? undefined : resolved;
  } catch {
    return undefined;
  }
}

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
      ...(input.config !== undefined ? { config: input.config } : {}),
      ...(input.warmup !== undefined ? { warmup: input.warmup } : {}),
      ...(input.guard !== undefined ? { guard: input.guard } : {}),
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
    store: {
      type: "string",
      description: "Override store directory (baked into the hook commands when non-default).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    noWarmup: {
      type: "boolean",
      default: false,
      description: "Skip the SessionStart warm-start hook.",
    },
    noGuard: {
      type: "boolean",
      default: false,
      description: "Skip the Mistake Firewall PreToolUse hook.",
    },
  },
  run({ args }) {
    const cliPath = resolveInvokedCliPath(process.argv[1]);
    const storeRoot = resolveBakedStoreRoot(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const config: HookCommandConfig = {
      ...(cliPath !== undefined ? { cliPath } : {}),
      ...(storeRoot !== undefined ? { storeRoot } : {}),
    };
    const code = runHooksInstall({
      target: typeof args.target === "string" ? args.target : "",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      config,
      warmup: !args.noWarmup,
      guard: !args.noGuard,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
