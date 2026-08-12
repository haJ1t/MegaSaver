import { isAbsolute, resolve } from "node:path";
import { listPeers } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type RunMeshStatusInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  json: boolean;
  all: boolean;
  follow: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  execGit?: (args: string[], cwd: string) => string;
  now?: () => number;
};

function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? cwd;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function resolveStoreRoot(input: RunMeshStatusInput): string {
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
  input: RunMeshStatusInput,
): Promise<{ workspaceKey?: string; repositoryFamilyKey?: string; all?: boolean }> {
  if (input.all) return { all: true };
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

export async function runMeshStatus(input: RunMeshStatusInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    await ensureStoreReady(storeRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cli = meshUnavailableMessage(detail);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let peers: ReturnType<typeof listPeers> = [];
  try {
    const filter = await resolveFilter(input);
    peers = listPeers(storeRoot, filter);
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.json) {
    input.stdout(JSON.stringify(peers, null, 2));
    return 0;
  }

  if (peers.length === 0) {
    input.stdout("no live peers");
    input.stdout("peers: 0");
    return 0;
  }

  const nowMs = input.now ? input.now() : Date.now();
  input.stdout(`peers (${peers.length})`);
  input.stdout("liveSessionId | agent | cwdShort | status | age");
  input.stdout("--------------|-------|----------|--------|-----");
  for (const p of peers) {
    const cwdShort = shortCwd(p.cwd);
    const seenMs = Date.parse(p.lastSeenAt);
    const ageMs = Number.isNaN(seenMs) ? 0 : Math.max(0, nowMs - seenMs);
    const ageSec = Math.floor(ageMs / 1000);
    const age =
      ageSec < 60
        ? `${ageSec}s`
        : ageSec < 3600
          ? `${Math.floor(ageSec / 60)}m`
          : `${Math.floor(ageSec / 3600)}h`;
    input.stdout(`${p.liveSessionId} | ${p.agent} | ${cwdShort} | ${p.status} | ${age}`);
  }

  if (input.follow) {
    input.stdout("follow: watching (polling disabled in this build)");
  }

  return 0;
}

export const meshStatusCommand = defineCommand({
  meta: { name: "status", description: "Show live mesh peers (files are truth)." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    all: { type: "boolean", default: false, description: "Show peers from all workspaces." },
    follow: { type: "boolean", default: false, description: "Watch for changes." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const json = Boolean((args as { json?: unknown }).json);
    const all = Boolean((args as { all?: unknown }).all);
    const follow = Boolean((args as { follow?: unknown }).follow);
    const env = readStoreEnv(storeFlag);
    const code = await runMeshStatus({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      json,
      all,
      follow,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
