import { basename, dirname } from "node:path";
import {
  canonicalFamilyPath,
  familyKeyFromPath,
  nodeResolverDeps,
  readExactRecord,
  readFamilyRecord,
  withActivationLock,
  writeExactRecord,
  writeFamilyRecord,
} from "@megasaver/context-gate";
import { type TokenSaverMode, encodeWorkspaceKey, tokenSaverModeSchema } from "@megasaver/shared";
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

type Scope =
  | { kind: "repository"; key: string; identityDigest: string; identityPath: string; root: string }
  | { kind: "exact"; workspaceKey: string };

// A cwd inside a Git repo (main root OR linked worktree) defaults to the family
// scope so all worktrees inherit it; --exact and non-Git cwds write an exact
// record. Mirrors the resolver so writes and reads agree.
function resolveScope(cwd: string, forceExact: boolean): Scope {
  if (!forceExact) {
    const deps = nodeResolverDeps();
    const git = deps.resolveGit(cwd);
    if (git.kind === "ok") {
      const canon = canonicalFamilyPath(git.commonDir, deps.platform, {
        realpathNative: deps.realpath,
        caseMode: deps.caseModeOf,
      });
      const fk = familyKeyFromPath(deps.platform, canon.caseMode, canon.canonicalPath);
      const root = basename(git.commonDir) === ".git" ? dirname(git.commonDir) : git.commonDir;
      return {
        kind: "repository",
        key: fk.key,
        identityDigest: fk.digestHex,
        identityPath: fk.identityPath,
        root,
      };
    }
  }
  return { kind: "exact", workspaceKey: encodeWorkspaceKey(cwd) };
}

function emit(
  input: { stdout: (line: string) => void; json?: boolean },
  scope: Scope,
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
      ? `repository family (covers all worktrees of ${scope.root})`
      : "this workspace only";
  input.stdout(`Mega Saver Mode ${enabled ? "enabled" : "disabled"} — ${coverage} (${mode})`);
}

function currentMode(store: string, scope: Scope, fallback: TokenSaverMode): TokenSaverMode {
  if (scope.kind === "repository") {
    const rec = readFamilyRecord(store, scope.key, scope.identityDigest);
    return rec !== null && rec !== "invalid" ? rec.mode : fallback;
  }
  const rec = readExactRecord(store, scope.workspaceKey);
  return rec.kind === "v1-exact" || rec.kind === "legacy" ? rec.mode : fallback;
}

function writeActivation(
  store: string,
  scope: Scope,
  enabled: boolean,
  mode: TokenSaverMode,
): void {
  withActivationLock(store, () => {
    if (scope.kind === "repository") {
      writeFamilyRecord(store, scope.key, {
        enabled,
        mode,
        identityDigest: scope.identityDigest,
        identityPath: scope.identityPath,
      });
    } else {
      writeExactRecord(store, scope.workspaceKey, { enabled, mode, scope: "exact" });
    }
  });
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
  const scope = resolveScope(input.cwd, input.exact);
  try {
    writeActivation(store, scope, true, mode);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
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
  const scope = resolveScope(input.cwd, input.exact);
  const mode = currentMode(store, scope, DEFAULT_MODE);
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
