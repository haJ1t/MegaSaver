import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type TokenSaverMode, encodeWorkspaceKey, tokenSaverModeSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import { invalidModeMessage, mapErrorToCliMessage } from "../../../errors.js";
import { type ResolveStorePathInput, readStoreEnv, resolveStorePath } from "../../../store.js";

const DEFAULT_MODE: TokenSaverMode = "balanced";

// EXACT shape the PostToolUse saver hook reads (apps/cli/src/hooks/saver-run.ts).
const settingsSchema = z.object({ enabled: z.boolean(), mode: tokenSaverModeSchema });
type WorkspaceSaverSettings = z.infer<typeof settingsSchema>;

export type RunSessionSaverWorkspaceEnableInput = ResolveStorePathInput & {
  modeFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export type RunSessionSaverWorkspaceDisableInput = ResolveStorePathInput & {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

function settingsFilePath(rootDir: string, cwd: string): { path: string; workspaceKey: string } {
  const workspaceKey = encodeWorkspaceKey(cwd);
  return { workspaceKey, path: join(rootDir, "stats", workspaceKey, "workspace-token-saver.json") };
}

function readWorkspaceSaverSettings(path: string): WorkspaceSaverSettings | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Temp-file-plus-rename so a concurrent saver-hook read never sees a partial
// file. Mirrors the durability dance in @megasaver/core's json-directory store,
// kept local because that helper is not part of core's public surface.
function atomicWriteJson(path: string, value: WorkspaceSaverSettings): void {
  const parentDir = dirname(path);
  mkdirSync(parentDir, { recursive: true });
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, JSON.stringify(value));
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, path);
    if (process.platform !== "win32") {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }
}

function emit(
  input: { stdout: (line: string) => void; json?: boolean },
  workspaceKey: string,
  path: string,
  settings: WorkspaceSaverSettings,
): void {
  if (input.json) {
    input.stdout(JSON.stringify({ workspaceKey, path, ...settings }));
    return;
  }
  input.stdout(
    `Mega Saver Mode ${settings.enabled ? "enabled" : "disabled"} for workspace ${workspaceKey} (${settings.mode})`,
  );
  input.stdout(`  store: ${path}`);
}

export async function runSessionSaverWorkspaceEnable(
  input: RunSessionSaverWorkspaceEnableInput,
): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
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

  const { workspaceKey, path } = settingsFilePath(rootDir, input.cwd);
  const settings: WorkspaceSaverSettings = { enabled: true, mode };
  try {
    atomicWriteJson(path, settings);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  emit(input, workspaceKey, path, settings);
  return 0;
}

export async function runSessionSaverWorkspaceDisable(
  input: RunSessionSaverWorkspaceDisableInput,
): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const { workspaceKey, path } = settingsFilePath(rootDir, input.cwd);
  const existing = readWorkspaceSaverSettings(path);
  const settings: WorkspaceSaverSettings = {
    enabled: false,
    mode: existing?.mode ?? DEFAULT_MODE,
  };
  try {
    atomicWriteJson(path, settings);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  emit(input, workspaceKey, path, settings);
  return 0;
}

export const sessionSaverWorkspaceEnableCommand = defineCommand({
  meta: {
    name: "enable",
    description: "Enable Mega Saver Mode for the current workspace (writes the saver gate file).",
  },
  args: {
    mode: {
      type: "string",
      description: `Token-saver mode (${tokenSaverModeSchema.options.join(" | ")}). Default ${DEFAULT_MODE}.`,
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverWorkspaceEnable({
      modeFlag: typeof args.mode === "string" ? args.mode : undefined,
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
    description: "Disable Mega Saver Mode for the current workspace (keeps the saver gate file).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverWorkspaceDisable({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionSaverWorkspaceCommand = defineCommand({
  meta: { name: "workspace", description: "Manage Mega Saver Mode for the current workspace." },
  subCommands: {
    enable: sessionSaverWorkspaceEnableCommand,
    disable: sessionSaverWorkspaceDisableCommand,
  },
});
