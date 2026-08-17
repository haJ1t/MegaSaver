import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  type ClaudeCodeHookResult,
  type HookCommandConfig,
  installClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { triggerCacheAdviceMaintenance } from "../../hooks/cache-advice-maintenance-trigger.js";
import { type ResolveStorePathInput, readStoreEnv, resolveStorePath } from "../../store.js";
import { buildExposureNudgeLines, collectExposureReport } from "../discover.js";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";

export type RunHooksInstallInput = {
  target: string;
  settingsPath: string;
  command?: string;
  config?: HookCommandConfig;
  warmup?: boolean;
  guard?: boolean;
  cacheAdvice?: boolean;
  meshHint?: boolean;
  execRewrite?: boolean;
  compactionGuard?: boolean;
  discover?: boolean;
  // Injectable for tests; production wires collectExposureReport (Task 4).
  discoverLines?: () => string[];
  platform?: NodeJS.Platform;
  storeFlag?: string;
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

// Phase 6 mesh: SessionStart warmup registers presence, PostToolUse saver heartbeats,
// PreToolUse guard checks claims + drains inbox. No new Hook process in Phase 1 —
// mesh rides the existing warmup/saver/guard handlers (managed block unchanged).
// Phase 8 mesh-hint: opt-in UserPromptSubmit mesh-hint (default off, --mesh-hints to enable).
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
      ...(input.compactionGuard !== undefined
        ? { compactionGuard: input.compactionGuard }
        : {}),
      ...(input.cacheAdvice !== undefined ? { cacheAdvice: input.cacheAdvice } : {}),
      ...(input.meshHint !== undefined ? { meshHint: input.meshHint } : {}),
      ...(input.execRewrite !== undefined ? { execRewrite: input.execRewrite } : {}),
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
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
  // Off-hook legacy migration (spec §2.3): after a successful install on
  // POSIX, best-effort trigger one detached maintainer. Fire-and-forget — the
  // trigger spawns detached and returns fast; a failure is a safe false
  // negative and never affects the install result.
  if ((input.platform ?? process.platform) !== "win32") {
    try {
      const storeRoot = resolveStorePath(readStoreEnv(input.storeFlag));
      void triggerCacheAdviceMaintenance({ storeRoot }).catch(() => undefined);
    } catch {
      // Best-effort maintenance must never affect the install result.
    }
  }
  // Opt-in exposure nudge (spec Locked Decision 9): best-effort exactly like
  // the maintenance trigger — a scan failure must never affect the install
  // result; JSON mode is unchanged (nudge is text-mode only, v1).
  if (input.discover === true && !input.json && input.discoverLines !== undefined) {
    try {
      for (const line of input.discoverLines()) input.stdout(line);
    } catch {
      // Best-effort nudge must never affect the install result.
    }
  }
  return 0;
}

export const hooksInstallCommand = defineCommand({
  meta: {
    name: "install",
    description: "Install the Claude Code Mega Saver hooks, including batch advice.",
  },
  args: {
    target: { type: "positional", required: true, description: "Hook target (claude-code)." },
    settings: { type: "string", description: "Override Claude Code settings.json path." },
    store: {
      type: "string",
      description: "Override store directory (baked into the hook commands when non-default).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    // Defined as positive flags (default true), not `no*` flags:
    // citty's `--no-<name>` negation sets the arg it names, so `--no-warmup`
    // populates `args.warmup = false`. A `noWarmup` arg would leave `noWarmup`
    // at its default and set a phantom `warmup`, silently ignoring the flag.
    warmup: {
      type: "boolean",
      default: true,
      description: "Install the SessionStart warm-start hook (--no-warmup to skip).",
    },
    guard: {
      type: "boolean",
      default: true,
      description: "Install the Mistake Firewall PreToolUse hook (--no-guard to skip).",
    },
    "compaction-guard": {
      type: "boolean",
      default: true,
      description:
        "Install the PreCompact capsule + post-compact recap hooks (--no-compaction-guard to skip).",
    },
    "cache-advice": {
      type: "boolean",
      default: true,
      description: "Install the batch-read advice hook (--no-cache-advice to disable).",
    },
    "mesh-hints": {
      type: "boolean",
      default: false,
      description: "Install the peer Q&A hint hook (--mesh-hints to enable).",
    },
    // Tri-state: NO default so the flag's absence preserves the current
    // settings state (LD9 gate a). --no-exec-rewrite removes.
    "exec-rewrite": {
      type: "boolean",
      description:
        "Install the exec-rewrite PreToolUse hook (--no-exec-rewrite removes; absent preserves).",
    },
    discover: {
      type: "boolean",
      default: false,
      description: "Append a top-3 unfiltered-exposure summary (reads local hook telemetry only).",
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
      warmup: args.warmup !== false,
      guard: args.guard !== false,
      compactionGuard: args["compaction-guard"] !== false,
      cacheAdvice: args["cache-advice"] !== false,
      meshHint: args["mesh-hints"] === true,
      ...(typeof args["exec-rewrite"] === "boolean" ? { execRewrite: args["exec-rewrite"] } : {}),
      discover: !!args.discover,
      discoverLines: () => {
        const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
        return buildExposureNudgeLines(
          collectExposureReport({ storeRoot: resolveStorePath(env), cwd: env.cwd }),
          3,
        );
      },
      platform: process.platform,
      ...(typeof args.store === "string" ? { storeFlag: args.store } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
