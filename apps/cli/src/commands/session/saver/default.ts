import { readGlobalDefault, withActivationLock, writeGlobalDefault } from "@megasaver/context-gate";
import { type TokenSaverMode, tokenSaverModeSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { invalidModeMessage, mapErrorToCliMessage } from "../../../errors.js";
import { type ResolveStorePathInput, readStoreEnv, resolveStorePath } from "../../../store.js";

const DEFAULT_MODE: TokenSaverMode = "balanced";

export type RunSessionSaverDefaultEnableInput = ResolveStorePathInput & {
  modeFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export type RunSessionSaverDefaultDisableInput = ResolveStorePathInput & {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

function emit(
  input: { stdout: (line: string) => void; json?: boolean },
  enabled: boolean,
  mode: TokenSaverMode,
): void {
  if (input.json) {
    input.stdout(JSON.stringify({ enabled, mode, scope: "global" }));
    return;
  }
  input.stdout(`Mega Saver Mode global default ${enabled ? "enabled" : "disabled"} (${mode})`);
}

export async function runSessionSaverDefaultEnable(
  input: RunSessionSaverDefaultEnableInput,
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
  try {
    withActivationLock(store, () => writeGlobalDefault(store, { enabled: true, mode }));
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  emit(input, true, mode);
  return 0;
}

export async function runSessionSaverDefaultDisable(
  input: RunSessionSaverDefaultDisableInput,
): Promise<0 | 1> {
  let store: string;
  try {
    store = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const existing = readGlobalDefault(store);
  const mode = existing !== null && existing !== "invalid" ? existing.mode : DEFAULT_MODE;
  try {
    withActivationLock(store, () => writeGlobalDefault(store, { enabled: false, mode }));
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  emit(input, false, mode);
  return 0;
}

export const sessionSaverDefaultEnableCommand = defineCommand({
  meta: { name: "enable", description: "Enable the machine-wide Mega Saver default." },
  args: {
    mode: {
      type: "string",
      description: `Token-saver mode (${tokenSaverModeSchema.options.join(" | ")}). Default ${DEFAULT_MODE}.`,
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverDefaultEnable({
      modeFlag: typeof args.mode === "string" ? args.mode : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionSaverDefaultDisableCommand = defineCommand({
  meta: { name: "disable", description: "Disable the machine-wide Mega Saver default." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverDefaultDisable({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionSaverDefaultCommand = defineCommand({
  meta: { name: "default", description: "Manage the machine-wide Mega Saver default." },
  subCommands: {
    enable: sessionSaverDefaultEnableCommand,
    disable: sessionSaverDefaultDisableCommand,
  },
});
