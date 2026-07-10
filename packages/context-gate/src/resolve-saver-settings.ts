import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  type RepositoryFamilyKey,
  type TokenSaverMode,
  type WorkspaceKey,
  encodeWorkspaceKey,
} from "@megasaver/shared";
import { type CaseMode, canonicalFamilyPath, familyKeyFromPath } from "./family-identity.js";
import { type GitCommonDirResult, nodeGitFamilyFs, resolveGitCommonDir } from "./git-family.js";
import { type PolicyModeFloor, clampModeToFloor, readPolicyModeFloor } from "./policy-floor.js";
import { readExactRecord, readFamilyRecord, readGlobalDefault } from "./saver-store.js";

export type SaverSource = "exact" | "repository" | "legacy-root" | "global" | "missing" | "invalid";
export type FamilyUnavailableReason =
  | "not_git"
  | "budget_exceeded"
  | "metadata_invalid"
  | "reciprocal_mismatch"
  | "foreign_worktree_admin"
  | "legacy_alias_unresolved"
  | null;

export type ResolvedWorkspaceTokenSaver = {
  enabled: boolean;
  mode: TokenSaverMode;
  requestedWorkspaceKey: WorkspaceKey;
  repositoryFamilyKey: RepositoryFamilyKey | null;
  source: SaverSource;
  sourceKey: WorkspaceKey | RepositoryFamilyKey | null;
  familyUnavailableReason: FamilyUnavailableReason;
  familyIdentityDiagnostic: "case_mode_unknown" | null;
  policyClamp: { floor: TokenSaverMode; original: TokenSaverMode } | null;
};

export type ResolverDeps = {
  platform: string;
  resolveGit: (cwd: string) => GitCommonDirResult;
  caseModeOf: (path: string) => CaseMode;
  realpath: (path: string) => string;
  readPolicyFloor: (cwd: string) => PolicyModeFloor | null;
};

const DEFAULT_MODE: TokenSaverMode = "safe";

function disabled(
  requestedWorkspaceKey: WorkspaceKey,
  source: SaverSource,
  familyUnavailableReason: FamilyUnavailableReason = null,
  familyIdentityDiagnostic: "case_mode_unknown" | null = null,
  repositoryFamilyKey: RepositoryFamilyKey | null = null,
): Omit<ResolvedWorkspaceTokenSaver, "policyClamp"> {
  return {
    enabled: false,
    mode: DEFAULT_MODE,
    requestedWorkspaceKey,
    repositoryFamilyKey,
    source,
    sourceKey: null,
    familyUnavailableReason,
    familyIdentityDiagnostic,
  };
}

// D19 enforcement is HERE and only here: every consumer (hook, daemon,
// resolve/status commands) goes through this resolver, so a repo-local
// floor cannot be bypassed by any store record.
export function resolveWorkspaceTokenSaverSettings(
  storeRoot: string,
  cwd: string,
  deps: ResolverDeps,
): ResolvedWorkspaceTokenSaver {
  const r = resolveUnclamped(storeRoot, cwd, deps);
  if (!r.enabled) return { ...r, policyClamp: null };
  const floor = deps.readPolicyFloor(cwd);
  if (floor === null) return { ...r, policyClamp: null };
  const clamped = clampModeToFloor(r.mode, floor);
  if (clamped === r.mode) return { ...r, policyClamp: null };
  return { ...r, mode: clamped, policyClamp: { floor, original: r.mode } };
}

// Precedence steps 0-4 per the design spec. Never spawns Git (git resolution is
// injected). Degraded git never resurrects a legacy record over a possible
// family disable it cannot see, but the git-independent global default still
// applies when no legacy record is present.
function resolveUnclamped(
  storeRoot: string,
  cwd: string,
  deps: ResolverDeps,
): Omit<ResolvedWorkspaceTokenSaver, "policyClamp"> {
  const requested = encodeWorkspaceKey(cwd);

  // Step 0-1: classify the exact record; a v1-exact override wins pre-Git.
  const exact = readExactRecord(storeRoot, requested);
  if (exact.kind === "invalid") return disabled(requested, "invalid");
  if (exact.kind === "v1-exact") {
    return {
      enabled: exact.enabled,
      mode: exact.mode,
      requestedWorkspaceKey: requested,
      repositoryFamilyKey: null,
      source: "exact",
      sourceKey: requested,
      familyUnavailableReason: null,
      familyIdentityDiagnostic: null,
    };
  }

  // Step 2: family resolution.
  const git = deps.resolveGit(cwd);
  let familyKey: RepositoryFamilyKey | null = null;
  let familyDigest: string | null = null;
  let diagnostic: "case_mode_unknown" | null = null;
  if (git.kind === "ok") {
    const canon = canonicalFamilyPath(git.commonDir, deps.platform, {
      realpathNative: deps.realpath,
      caseMode: deps.caseModeOf,
    });
    const fk = familyKeyFromPath(deps.platform, canon.caseMode, canon.canonicalPath);
    familyKey = fk.key;
    familyDigest = fk.digestHex;
    diagnostic = canon.diagnostic;
  }
  const gitReason: FamilyUnavailableReason =
    git.kind === "not_git" ? "not_git" : git.kind === "degraded" ? git.reason : null;

  // Step 3: legacy-unversioned exact record.
  if (exact.kind === "legacy") {
    if (git.kind === "not_git") {
      return {
        enabled: exact.enabled,
        mode: exact.mode,
        requestedWorkspaceKey: requested,
        repositoryFamilyKey: null,
        source: "exact",
        sourceKey: requested,
        familyUnavailableReason: "not_git",
        familyIdentityDiagnostic: null,
      };
    }
    if (git.kind === "degraded") {
      return disabled(requested, "invalid", git.reason);
    }
    // git ok → the legacy record is owned by the family/legacy-root stages below.
  }

  // Step 4: fallback.
  if (git.kind === "ok" && familyKey !== null && familyDigest !== null) {
    const fam = readFamilyRecord(storeRoot, familyKey, familyDigest);
    if (fam === "invalid") return disabled(requested, "invalid", null, diagnostic, familyKey);
    if (fam !== null) {
      return {
        enabled: fam.enabled,
        mode: fam.mode,
        requestedWorkspaceKey: requested,
        repositoryFamilyKey: familyKey,
        source: "repository",
        sourceKey: familyKey,
        familyUnavailableReason: null,
        familyIdentityDiagnostic: diagnostic,
      };
    }
    const legacyRoot = probeLegacyRoot(storeRoot, cwd, git.commonDir, deps);
    if (legacyRoot !== null) {
      return {
        enabled: legacyRoot.enabled,
        mode: legacyRoot.mode,
        requestedWorkspaceKey: requested,
        repositoryFamilyKey: familyKey,
        source: "legacy-root",
        sourceKey: legacyRoot.key,
        familyUnavailableReason: null,
        familyIdentityDiagnostic: diagnostic,
      };
    }
  }

  // Global default (reachable on ok/not_git/degraded when no more-specific record
  // resolved), else disabled.
  const glob = readGlobalDefault(storeRoot);
  if (glob === "invalid") return disabled(requested, "invalid", gitReason, diagnostic, familyKey);
  if (glob !== null) {
    return {
      enabled: glob.enabled,
      mode: glob.mode,
      requestedWorkspaceKey: requested,
      repositoryFamilyKey: familyKey,
      source: "global",
      sourceKey: null,
      familyUnavailableReason: gitReason,
      familyIdentityDiagnostic: diagnostic,
    };
  }
  return disabled(requested, "missing", gitReason, diagnostic, familyKey);
}

// The legacy main-root exact activation is a family fallback only when the common
// directory is the root's in-tree `.git` dir. Probes the canonical main-root key
// and the raw cwd-ancestor whose `.git` resolves to this common dir.
function probeLegacyRoot(
  storeRoot: string,
  cwd: string,
  commonDir: string,
  deps: ResolverDeps,
): { enabled: boolean; mode: TokenSaverMode; key: WorkspaceKey } | null {
  if (basename(commonDir) !== ".git") return null; // separate-git-dir → new family record required
  const candidates = new Set<WorkspaceKey>();
  candidates.add(encodeWorkspaceKey(dirname(commonDir))); // canonical main root
  let dir = resolve(cwd);
  for (let i = 0; i < 32; i++) {
    try {
      if (deps.realpath(join(dir, ".git")) === commonDir) {
        candidates.add(encodeWorkspaceKey(dir)); // raw main-root spelling
        break;
      }
    } catch {
      /* no .git here */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const key of candidates) {
    const rec = readExactRecord(storeRoot, key);
    if (rec.kind === "legacy") return { enabled: rec.enabled, mode: rec.mode, key };
  }
  return null;
}

// Runtime deps for the hook/CLI. caseMode is probed non-mutatingly (dev+ino of a
// case-swapped sibling); indeterminate volumes stay "unknown" rather than guess.
export function nodeResolverDeps(): ResolverDeps {
  return {
    platform: process.platform,
    resolveGit: (cwd) => resolveGitCommonDir(cwd, nodeGitFamilyFs),
    caseModeOf: detectCaseMode,
    realpath: (p) => realpathSync.native(p),
    readPolicyFloor: readPolicyModeFloor,
  };
}

function detectCaseMode(path: string): CaseMode {
  const swapped = swapCase(path);
  if (swapped === path) return "unknown"; // no cased letters to probe
  try {
    const a = lstatSync(path);
    try {
      const b = lstatSync(swapped);
      return a.dev === b.dev && a.ino === b.ino ? "insensitive" : "sensitive";
    } catch {
      return "sensitive"; // swapped-case sibling does not exist → case-sensitive
    }
  } catch {
    return "unknown";
  }
}

function swapCase(s: string): string {
  let out = "";
  for (const ch of s) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    out += ch === lo ? up : lo;
  }
  return out;
}
