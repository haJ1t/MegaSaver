import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { claimRecordSchema, meshPaths, quarantineFileSync, safeJsonParse } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export type RunMeshClaimsInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  json?: boolean;
  repo?: string;
  all?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  execGit?: (args: string[], cwd: string) => string;
};

function resolveStoreRoot(input: RunMeshClaimsInput): string {
  if (input.storeFlag !== undefined) {
    const trimmed = input.storeFlag.trim();
    if (trimmed.length === 0) throw new Error("store path must be non-empty");
    return isAbsolute(trimmed) ? trimmed : resolve(input.cwd, trimmed);
  }
  if (input.home !== undefined) {
    return resolveStorePath({
      storeFlag: undefined,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform ?? process.platform,
      localAppData: input.localAppData,
    });
  }
  return resolveStorePath(readStoreEnv(undefined));
}

async function resolveFilter(
  input: RunMeshClaimsInput,
): Promise<{ workspaceKey?: string; repositoryFamilyKey?: string; all?: boolean }> {
  if (input.all) return { all: true };
  if (input.repo !== undefined && input.repo.trim().length > 0) {
    const r = input.repo.trim();
    if (/^gf1_[A-Za-z0-9_-]{43}$/.test(r)) return { repositoryFamilyKey: r };
    if (/^[0-9a-f]{16}$/.test(r)) return { workspaceKey: r };
  }
  if (input.execGit !== undefined) {
    try {
      const raw = input.execGit(["rev-parse", "--git-common-dir"], input.cwd);
      if (typeof raw === "string" && raw.trim().length > 0 && raw.trim() !== "--git-common-dir") {
        const commonDir = raw.trim();
        const absoluteCommon =
          isAbsolute(commonDir) || /^[A-Za-z]:/.test(commonDir)
            ? commonDir
            : resolve(input.cwd, commonDir);
        const { canonicalFamilyPath, familyKeyFromPath } = await import("@megasaver/context-gate");
        const canon = canonicalFamilyPath(absoluteCommon, input.platform ?? process.platform, {
          realpathNative: (p: string) => p,
          caseMode: (_p: string) =>
            input.platform === "darwin" || input.platform === "win32"
              ? ("insensitive" as const)
              : ("sensitive" as const),
        });
        const fk = familyKeyFromPath(
          input.platform ?? process.platform,
          canon.caseMode,
          canon.canonicalPath,
        );
        return { repositoryFamilyKey: fk.key };
      }
    } catch {}
  }
  return { workspaceKey: encodeWorkspaceKey(input.cwd) };
}

function sameScope(
  record: { workspaceKey: string; repositoryFamilyKey?: string | undefined },
  filter: {
    workspaceKey?: string | undefined;
    repositoryFamilyKey?: string | undefined;
    all?: boolean;
  },
): boolean {
  if (filter.all) return true;
  if (filter.workspaceKey === undefined && filter.repositoryFamilyKey === undefined) return true;
  const filterHasFamily = filter.repositoryFamilyKey !== undefined;
  const recordHasFamily = record.repositoryFamilyKey !== undefined;
  if (filterHasFamily && recordHasFamily) {
    return record.repositoryFamilyKey === filter.repositoryFamilyKey;
  }
  if (filter.workspaceKey === undefined) return false;
  return record.workspaceKey === filter.workspaceKey;
}

export async function runMeshClaims(input: RunMeshClaimsInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const filter = await resolveFilter(input);

  const { claimsDir } = meshPaths(storeRoot);
  if (!existsSync(claimsDir)) {
    if (input.json) input.stdout(JSON.stringify([], null, 2));
    else {
      input.stdout("claims: 0");
      input.stdout("no claims");
    }
    return 0;
  }

  let files: string[] = [];
  try {
    files = readdirSync(claimsDir);
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const nowMs = Date.now();
  const claims: unknown[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(claimsDir, file);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (raw.trim() === "") {
      try {
        quarantineFileSync(filePath, storeRoot);
      } catch {}
      continue;
    }
    const parsedJson = safeJsonParse(raw);
    if (parsedJson === undefined) {
      try {
        quarantineFileSync(filePath, storeRoot);
      } catch {}
      continue;
    }
    const result = claimRecordSchema.safeParse(parsedJson);
    if (!result.success) {
      try {
        quarantineFileSync(filePath, storeRoot);
      } catch {}
      continue;
    }
    const rec = result.data;
    const expiresMs = Date.parse(rec.expiresAt);
    if (!Number.isNaN(expiresMs) && expiresMs <= nowMs) continue;
    if (!sameScope(rec, filter)) continue;
    claims.push(rec);
  }

  if (input.json) {
    input.stdout(JSON.stringify(claims, null, 2));
    return 0;
  }

  if (claims.length === 0) {
    input.stdout("claims: 0");
    input.stdout("no claims");
    return 0;
  }

  input.stdout(`claims (${claims.length})`);
  input.stdout("claimId | liveSessionId | paths | expiresAt");
  input.stdout("--------|---------------|-------|----------");
  for (const c of claims as Array<{
    claimId: string;
    liveSessionId: string;
    paths: string[];
    expiresAt: string;
  }>) {
    input.stdout(`${c.claimId} | ${c.liveSessionId} | ${c.paths.join(",")} | ${c.expiresAt}`);
  }

  return 0;
}

export const meshClaimsCommand = defineCommand({
  meta: { name: "claims", description: "List active mesh claims (advisory, TTL 30m)." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    repo: { type: "string", description: "Filter by repository family key or workspace key." },
    all: { type: "boolean", default: false, description: "Show claims from all workspaces." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const json = Boolean((args as { json?: unknown }).json);
    const all = Boolean((args as { all?: unknown }).all);
    const repo =
      typeof (args as { repo?: unknown }).repo === "string"
        ? ((args as { repo: string }).repo as string)
        : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runMeshClaims({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      json,
      all,
      ...(repo !== undefined ? { repo } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
