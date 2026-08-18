import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import {
  type HookCommandConfig,
  resolveClaudeCodeSettingsPath,
} from "@megasaver/connector-claude-code";
import { type TokenSaverMode, encodeWorkspaceKey, tokenSaverModeSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { invalidModeMessage, mapErrorToCliMessage } from "../errors.js";
import { CLAUDE_CODE_TARGET, KNOWN_TARGETS, isKnownTargetId } from "../known-targets.js";
import { ensureStoreReady, readStoreEnv, resolveHomeDir, resolveStorePath } from "../store.js";
import { type UpApplyDeps, runUpApply } from "../up/apply.js";
import { detectUpState } from "../up/detect.js";
import { buildUpPlan, renderUpPlan } from "../up/plan.js";
import { type UpVerifyDeps, runUpVerify } from "../up/verify.js";
import { runConnectorSync } from "./connector/sync.js";
import { runGui } from "./gui.js";
import { resolveBakedStoreRoot, resolveInvokedCliPath, runHooksInstall } from "./hooks/install.js";
import { confirmYesNo } from "./init.js";
import { runProjectCreate } from "./project.js";
import { runSessionSaverWorkspaceEnable } from "./session/saver/workspace.js";
import { findProjectByCwd } from "./warmup.js";

export type RunUpInput = {
  mode?: TokenSaverMode;
  yes: boolean;
  planOnly: boolean;
  exact: boolean;
  gui: boolean;
  targetIds: string[];
  settingsPath: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  isTTY: boolean;
  json: boolean;
  deps: {
    apply: UpApplyDeps;
    verify: UpVerifyDeps;
    prompt: () => Promise<boolean>;
    gui: () => Promise<unknown>;
  };
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runUp(input: RunUpInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const targets = input.targetIds.map((id) => {
    const found = KNOWN_TARGETS.find((t) => t.id === id);
    return found ?? CLAUDE_CODE_TARGET;
  });

  const config: HookCommandConfig = {};

  const state = await detectUpState({
    settingsPath: input.settingsPath,
    storeRoot: rootDir,
    cwd: input.cwd,
    targets,
    config,
    platform: input.platform,
  });

  const mode: TokenSaverMode = input.mode ?? "balanced";
  const plan = buildUpPlan(state, mode);

  if (input.json) {
    input.stdout(JSON.stringify({ plan, state }));
  } else {
    for (const line of renderUpPlan(plan)) {
      input.stdout(line);
    }
  }

  if (plan.hasConflict) {
    return 1;
  }

  if (input.planOnly) {
    return 0;
  }

  if (plan.hasWork) {
    if (!input.yes && !input.isTTY) {
      input.stderr("error: refusing to write without --yes in non-TTY environment");
      return 1;
    }
    if (!input.yes) {
      const ok = await input.deps.prompt();
      if (!ok) return 0;
    }

    const workspaceKey = encodeWorkspaceKey(input.cwd);
    const applied = await runUpApply({
      plan,
      state,
      storeRoot: rootDir,
      workspaceKey,
      cwd: input.cwd,
      mode,
      exact: input.exact,
      deps: input.deps.apply,
    });

    if (applied.code !== 0) {
      input.stderr(`error: apply failed at step "${applied.failedStep}"`);
      return 1;
    }
  }

  const verification = runUpVerify({
    settingsPath: input.settingsPath,
    storeRoot: rootDir,
    cwd: input.cwd,
    deps: input.deps.verify,
  });

  if (!input.json) {
    input.stdout("");
    input.stdout("verify:");
    input.stdout(`  saver:     ${verification.saver.kind.padEnd(10)} ${verification.saver.detail}`);
    for (const p of verification.passive) {
      input.stdout(`  ${p}`);
    }
    input.stdout(`  daemon:    ${verification.daemon}`);
  }

  if (verification.saver.kind === "failed") {
    return 1;
  }

  if (input.gui) {
    try {
      await input.deps.gui();
    } catch {
      // gui failure is non-fatal
    }
  }

  return 0;
}

export const upCommand = defineCommand({
  meta: {
    name: "up",
    description: "Activate Mega Saver for this workspace in one idempotent transaction.",
  },
  args: {
    mode: {
      type: "string",
      description: "Default saver mode (safe | balanced | aggressive).",
    },
    yes: {
      type: "boolean",
      default: false,
      description: "Skip confirmation prompt.",
    },
    plan: {
      type: "boolean",
      default: false,
      description: "Print plan and exit without modifying anything.",
    },
    exact: {
      type: "boolean",
      default: false,
      description: "Scope saver activation to exact directory instead of repository family.",
    },
    gui: {
      type: "boolean",
      default: false,
      description: "Open GUI after activation.",
    },
    target: {
      type: "string",
      description: "Connector target id (default: claude-code).",
    },
    settings: {
      type: "string",
      description: "Override Claude Code settings.json path.",
    },
    store: {
      type: "string",
      description: "Override store directory.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit structured JSON output.",
    },
  },
  async run({ args }) {
    let mode: TokenSaverMode | undefined;
    if (typeof args.mode === "string") {
      const parsed = tokenSaverModeSchema.safeParse(args.mode);
      if (!parsed.success) {
        const cli = invalidModeMessage(args.mode);
        console.error(cli.message);
        process.exitCode = cli.exitCode;
        return;
      }
      mode = parsed.data;
    }

    const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const settingsPath =
      typeof args.settings === "string"
        ? args.settings
        : resolveClaudeCodeSettingsPath({ home: resolveHomeDir() });

    const targetIds: string[] = [];
    if (typeof args.target === "string" && isKnownTargetId(args.target)) {
      targetIds.push(args.target);
    } else {
      targetIds.push("claude-code");
    }

    const bakedStore = resolveBakedStoreRoot({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
    });
    const cliPath = resolveInvokedCliPath(process.argv[1]);
    const config: HookCommandConfig = {
      ...(cliPath !== undefined ? { cliPath } : {}),
      ...(bakedStore !== undefined ? { storeRoot: bakedStore } : {}),
    };

    const code = await runUp({
      ...(mode !== undefined ? { mode } : {}),
      yes: Boolean(args.yes),
      planOnly: Boolean(args.plan),
      exact: Boolean(args.exact),
      gui: Boolean(args.gui),
      targetIds,
      settingsPath,
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      isTTY: Boolean(process.stdin.isTTY),
      json: Boolean(args.json),
      deps: {
        apply: {
          hooksInstall: () =>
            runHooksInstall({
              target: "claude-code",
              settingsPath,
              config,
              json: false,
              stdout: (l) => console.log(l),
              stderr: (l) => console.error(l),
            }),
          ensureProject: async () => {
            const { registry } = await ensureStoreReady(
              resolveStorePath({
                storeFlag: env.storeFlag,
                cwd: env.cwd,
                home: env.home,
                xdgDataHome: env.xdgDataHome,
                platform: env.platform,
                localAppData: env.localAppData,
              }),
            );
            const found = findProjectByCwd(registry.listProjects(), env.cwd);
            if (found !== null) {
              return { code: 0, name: found.name, created: false };
            }
            const name = basename(env.cwd);
            const createCode = await runProjectCreate({
              name,
              rootFlag: undefined,
              storeFlag: env.storeFlag,
              cwd: env.cwd,
              home: env.home,
              xdgDataHome: env.xdgDataHome,
              platform: env.platform,
              localAppData: env.localAppData,
              stdout: () => {},
              stderr: (l) => console.error(l),
            });
            return { code: createCode, name, created: createCode === 0 };
          },
          connectorSync: async (projectName, targetId) =>
            runConnectorSync({
              projectName,
              targetFlag: targetId,
              storeFlag: env.storeFlag,
              cwd: env.cwd,
              home: env.home,
              xdgDataHome: env.xdgDataHome,
              platform: env.platform,
              localAppData: env.localAppData,
              json: false,
              stdout: () => {},
              stderr: (l) => console.error(l),
            }),
          saverEnable: async () =>
            runSessionSaverWorkspaceEnable({
              modeFlag: mode,
              exact: Boolean(args.exact),
              storeFlag: env.storeFlag,
              cwd: env.cwd,
              home: env.home,
              xdgDataHome: env.xdgDataHome,
              platform: env.platform,
              localAppData: env.localAppData,
              stdout: () => {},
              stderr: (l) => console.error(l),
            }),
          now: () => new Date().toISOString(),
        },
        verify: {
          spawn: (cmd, stdinJson, timeoutMs) => {
            try {
              const res = spawnSync(cmd, {
                input: stdinJson,
                timeout: timeoutMs,
                shell: true,
                encoding: "utf8",
              });
              return {
                status: res.status,
                ...(res.stdout ? { stdout: res.stdout } : {}),
                ...(res.error?.message ? { error: res.error.message } : {}),
              };
            } catch (err) {
              return {
                status: 1,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
          now: Date.now,
        },
        prompt: () => confirmYesNo("Apply this plan? (y/n) "),
        gui: async () =>
          runGui({
            open: true,
            port: 0,
            stdout: (l) => console.log(l),
            stderr: (l) => console.error(l),
            ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
          }),
      },
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });

    if (code !== 0) process.exitCode = code;
  },
});
