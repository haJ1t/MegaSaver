import {
  type ActivationScope,
  clampModeToFloor,
  readActivationMode,
  readPolicyModeFloor,
  resolveActivationScope,
  writeActivation,
} from "@megasaver/context-gate";
import { type TokenSaverMode, tokenSaverModeSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { invalidModeMessage, mapErrorToCliMessage } from "../../../errors.js";
import { type ResolveStorePathInput, readStoreEnv, resolveStorePath } from "../../../store.js";

const DEFAULT_MODE: TokenSaverMode = "balanced";

export type RunSessionSaverWorkspaceEnableInput = ResolveStorePathInput & {
  modeFlag: string | undefined;
  exact: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export type RunSessionSaverWorkspaceDisableInput = ResolveStorePathInput & {
  exact: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

function emit(
  input: { stdout: (line: string) => void; json?: boolean },
  scope: ActivationScope,
  enabled: boolean,
  mode: TokenSaverMode,
): void {
  if (input.json) {
    const base = { enabled, mode, scope: scope.kind };
    input.stdout(
      JSON.stringify(
        scope.kind === "repository"
          ? { ...base, repositoryFamilyKey: scope.key, root: scope.root }
          : { ...base, workspaceKey: scope.workspaceKey },
      ),
    );
    return;
  }
  const coverage =
    scope.kind === "repository"
      ? `repository family (covers all worktrees of ${scope.root}; a checkout's own --exact override still wins — see \`mega session saver resolve\`)`
      : "this workspace only";
  input.stdout(`Mega Saver Mode ${enabled ? "enabled" : "disabled"} — ${coverage} (${mode})`);
}

export async function runSessionSaverWorkspaceEnable(
  input: RunSessionSaverWorkspaceEnableInput,
): Promise<0 | 1> {
  let store: string;
  try {
    store = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let mode: TokenSaverMode = DEFAULT_MODE;
  if (input.modeFlag !== undefined) {
    const parsed = tokenSaverModeSchema.safeParse(input.modeFlag);
    if (!parsed.success) {
      const cli = invalidModeMessage(input.modeFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    mode = parsed.data;
  }
  const scope = resolveActivationScope(input.cwd, input.exact);
  try {
    writeActivation(store, scope, true, mode);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const floor = readPolicyModeFloor(input.cwd);
  if (floor !== null && clampModeToFloor(mode, floor) !== mode) {
    input.stderr(
      `note: .megasaver/policy.json floors this repository at "${floor}" — the "${mode}" record is written but resolves as "${floor}"`,
    );
  }
  emit(input, scope, true, mode);
  return 0;
}

export async function runSessionSaverWorkspaceDisable(
  input: RunSessionSaverWorkspaceDisableInput,
): Promise<0 | 1> {
  let store: string;
  try {
    store = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const scope = resolveActivationScope(input.cwd, input.exact);
  const mode = readActivationMode(store, scope, DEFAULT_MODE);
  try {
    writeActivation(store, scope, false, mode);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  emit(input, scope, false, mode);
  return 0;
}

const modeArg = {
  type: "string" as const,
  description: `Token-saver mode (${tokenSaverModeSchema.options.join(" | ")}). Default ${DEFAULT_MODE}.`,
};
const exactArg = {
  type: "boolean" as const,
  default: false,
  description: "Write a this-checkout-only record instead of the repository family.",
};

export const sessionSaverWorkspaceEnableCommand = defineCommand({
  meta: {
    name: "enable",
    description:
      "Enable Mega Saver Mode. In a Git repo this activates the whole family (all worktrees); use --exact for this checkout only.",
  },
  args: {
    mode: modeArg,
    exact: exactArg,
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverWorkspaceEnable({
      modeFlag: typeof args.mode === "string" ? args.mode : undefined,
      exact: !!args.exact,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionSaverWorkspaceDisableCommand = defineCommand({
  meta: {
    name: "disable",
    description:
      "Disable Mega Saver Mode. In a Git repo this disables the whole family; use --exact for this checkout only.",
  },
  args: {
    exact: exactArg,
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverWorkspaceDisable({
      exact: !!args.exact,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionSaverWorkspaceCommand = defineCommand({
  meta: {
    name: "workspace",
    description: "Manage Mega Saver Mode for the current repository/workspace.",
  },
  subCommands: {
    enable: sessionSaverWorkspaceEnableCommand,
    disable: sessionSaverWorkspaceDisableCommand,
  },
});
