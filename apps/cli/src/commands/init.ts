import { createInterface } from "node:readline";
import { type TokenSaverMode, tokenSaverModeSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { invalidModeMessage } from "../errors.js";
import { readStoreEnv, resolveHomeDir } from "../store.js";
import { runGui } from "./gui.js";
import { runHooksInstall } from "./hooks/install.js";
import { resolveClaudeCodeSettingsPath } from "./hooks/settings-path.js";
import { runMcpInstall } from "./mcp/install.js";
import { runSessionSaverWorkspaceEnable } from "./session/saver/workspace.js";

const MCP_TARGET = "claude-code";

export type RunInitDeps = {
  hooksInstall: () => Promise<0 | 1> | 0 | 1;
  mcpInstall: () => Promise<0 | 1>;
  saverEnable: (mode: TokenSaverMode) => Promise<0 | 1>;
  gui: () => Promise<unknown>;
  prompt: () => Promise<boolean>;
  stdout: (line: string) => void;
  isTTY: boolean;
};

export type RunInitInput = {
  storeRoot: string;
  cwd: string;
  mode?: TokenSaverMode;
  yes?: boolean;
  openGui?: boolean;
  deps: RunInitDeps;
};

type StepResult = { label: string; ok: boolean };

export async function runInit(input: RunInitInput): Promise<0 | 1> {
  const { deps } = input;
  const mode = input.mode ?? "balanced";
  const yes = input.yes ?? false;
  const openGui = input.openGui ?? true;

  deps.stdout("mega init — one-command onboarding. This will:");
  deps.stdout("  1. install Claude Code hooks (telemetry + saver)");
  deps.stdout(`  2. install the mcp bridge (${MCP_TARGET})`);
  deps.stdout(`  3. enable the workspace saver (mode: ${mode})`);
  deps.stdout(openGui ? "  4. open the mega gui dashboard" : "  4. (gui skipped: --no-gui)");

  // Confirm only in an interactive TTY without --yes. --yes and non-TTY (CI)
  // proceed without ever touching the prompt so scripted runs never block.
  if (deps.isTTY && !yes) {
    const proceed = await deps.prompt();
    if (!proceed) {
      deps.stdout("aborted — nothing was changed.");
      return 0;
    }
  }

  // Continue-and-report: each step runs regardless of a prior failure so the
  // user still gets everything that worked.
  const steps: StepResult[] = [];
  steps.push({ label: "hooks installed", ok: (await deps.hooksInstall()) === 0 });
  steps.push({ label: `mcp bridge (${MCP_TARGET})`, ok: (await deps.mcpInstall()) === 0 });
  steps.push({ label: `saver on (${mode})`, ok: (await deps.saverEnable(mode)) === 0 });

  deps.stdout("");
  deps.stdout("Summary:");
  for (const step of steps) deps.stdout(`  ${step.ok ? "✓" : "✗"} ${step.label}`);

  const failed = steps.some((s) => !s.ok);
  deps.stdout(
    failed
      ? "Next: re-run `mega init` to retry the failed step(s), then open the dashboard with `mega gui`."
      : "Next: use Claude Code as usual, then open the dashboard with `mega gui`.",
  );

  // GUI is the terminal handoff: it blocks on the server, so the full summary is
  // already printed above before we hand off.
  if (openGui) await deps.gui();

  return failed ? 1 : 0;
}

function confirmYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description:
      "One-command onboarding: install hooks + mcp bridge, enable the saver, and open the GUI.",
  },
  args: {
    mode: {
      type: "string",
      description: `Token-saver mode (${tokenSaverModeSchema.options.join(" | ")}). Default balanced.`,
    },
    yes: {
      type: "boolean",
      default: false,
      description: "Proceed without the confirmation prompt.",
    },
    gui: {
      type: "boolean",
      default: true,
      description: "Open the GUI dashboard. Use --no-gui to skip.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const modeFlag = typeof args.mode === "string" ? args.mode : undefined;
    let mode: TokenSaverMode = "balanced";
    if (modeFlag !== undefined) {
      const parsed = tokenSaverModeSchema.safeParse(modeFlag);
      if (!parsed.success) {
        const cli = invalidModeMessage(modeFlag);
        console.error(cli.message);
        process.exitCode = cli.exitCode;
        return;
      }
      mode = parsed.data;
    }

    const storeFlag = typeof args.store === "string" ? args.store : undefined;
    const storeEnv = readStoreEnv(storeFlag);
    const stdout = (line: string) => console.log(line);
    const stderr = (line: string) => console.error(line);

    const deps: RunInitDeps = {
      hooksInstall: () =>
        runHooksInstall({
          target: MCP_TARGET,
          settingsPath: resolveClaudeCodeSettingsPath(),
          stdout,
          stderr,
          json: false,
        }),
      mcpInstall: () =>
        runMcpInstall({
          targetFlag: MCP_TARGET,
          home: resolveHomeDir(),
          stdout,
          stderr,
          json: false,
        }),
      saverEnable: (m) =>
        runSessionSaverWorkspaceEnable({
          modeFlag: m,
          exact: false,
          ...storeEnv,
          stdout,
          stderr,
          json: false,
        }),
      gui: () =>
        runGui({
          port: 0,
          open: true,
          ...storeEnv,
          stdout,
          stderr,
        }),
      prompt: () => confirmYesNo("Proceed? [y/N] "),
      stdout,
      isTTY: !!process.stdout.isTTY,
    };

    const code = await runInit({
      storeRoot: storeEnv.storeFlag ?? storeEnv.cwd,
      cwd: storeEnv.cwd,
      mode,
      yes: !!args.yes,
      openGui: args.gui !== false,
      deps,
    });
    if (code !== 0) process.exitCode = code;
  },
});
