import { basename, dirname } from "node:path";
import { type TokenSaverMode, encodeWorkspaceKey } from "@megasaver/shared";
import { canonicalFamilyPath, familyKeyFromPath } from "./family-identity.js";
import { type ResolverDeps, nodeResolverDeps } from "./resolve-saver-settings.js";
import {
  readExactRecord,
  readFamilyRecord,
  withActivationLock,
  writeExactRecord,
  writeFamilyRecord,
} from "./saver-store.js";

export type ActivationScope =
  | {
      kind: "repository";
      key: string;
      identityDigest: string;
      identityPath: string;
      root: string;
    }
  | { kind: "exact"; workspaceKey: string };

// Where a workspace toggle should write. A cwd inside a Git repo (main root OR
// linked worktree) defaults to the family scope so every worktree inherits it;
// --exact and non-Git cwds write an exact record. Shared by the CLI, the GUI
// bridge, and any other writer so writes and reads never drift.
export function resolveActivationScope(
  cwd: string,
  forceExact: boolean,
  deps: ResolverDeps = nodeResolverDeps(),
): ActivationScope {
  if (!forceExact) {
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

export function writeActivation(
  storeRoot: string,
  scope: ActivationScope,
  enabled: boolean,
  mode: TokenSaverMode,
): void {
  withActivationLock(storeRoot, () => {
    if (scope.kind === "repository") {
      writeFamilyRecord(storeRoot, scope.key, {
        enabled,
        mode,
        identityDigest: scope.identityDigest,
        identityPath: scope.identityPath,
      });
    } else {
      writeExactRecord(storeRoot, scope.workspaceKey, { enabled, mode, scope: "exact" });
    }
  });
}

export function readActivationMode(
  storeRoot: string,
  scope: ActivationScope,
  fallback: TokenSaverMode,
): TokenSaverMode {
  if (scope.kind === "repository") {
    const rec = readFamilyRecord(storeRoot, scope.key, scope.identityDigest);
    return rec !== null && rec !== "invalid" ? rec.mode : fallback;
  }
  const rec = readExactRecord(storeRoot, scope.workspaceKey);
  return rec.kind === "v1-exact" || rec.kind === "legacy" ? rec.mode : fallback;
}
