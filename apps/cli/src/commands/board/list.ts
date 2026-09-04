import { isAbsolute, resolve } from "node:path";
import { readBoardFacts } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

function resolveStoreRoot(input: {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
}): string {
  if (input.storeFlag !== undefined) {
    const trimmed = input.storeFlag.trim();
    if (trimmed.length === 0) throw new Error("Store path must be non-empty.");
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

async function resolveRepoKey(
  cwd: string,
  platform: NodeJS.Platform | undefined,
  execGit?: (args: string[], cwd: string) => string,
): Promise<string | undefined> {
  if (execGit !== undefined) {
    try {
      const raw = execGit(["rev-parse", "--git-common-dir"], cwd);
      if (typeof raw === "string" && raw.trim().length > 0 && raw.trim() !== "--git-common-dir") {
        const commonDir = raw.trim();
        const absoluteCommon =
          isAbsolute(commonDir) || /^[A-Za-z]:/.test(commonDir)
            ? commonDir
            : resolve(cwd, commonDir);
        const { canonicalFamilyPath, familyKeyFromPath } = await import("@megasaver/context-gate");
        const canon = canonicalFamilyPath(absoluteCommon, platform ?? process.platform, {
          realpathNative: (p: string) => p,
          caseMode: (_p: string) =>
            platform === "darwin" || platform === "win32"
              ? ("insensitive" as const)
              : ("sensitive" as const),
        });
        const fk = familyKeyFromPath(
          platform ?? process.platform,
          canon.caseMode,
          canon.canonicalPath,
        );
        return fk.key;
      }
    } catch {}
  }
  return encodeWorkspaceKey(cwd);
}

export type RunBoardListInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  repo?: string | undefined;
  topic?: string | undefined;
  status?: string | undefined;
  all?: boolean;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  execGit?: (args: string[], cwd: string) => string;
};

export async function runBoardList(input: RunBoardListInput): Promise<0 | 1> {
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

  let repoFilter: string | undefined = input.repo;
  if (repoFilter === undefined && !input.all) {
    try {
      repoFilter = await resolveRepoKey(input.cwd, input.platform, input.execGit);
    } catch {}
  }
  if (input.all) repoFilter = undefined;

  const statusFilter: string | undefined = input.status;
  if (statusFilter !== undefined && !["active", "disputed", "resolved"].includes(statusFilter)) {
    const cli = mapErrorToCliMessage(new Error(`invalid status: ${statusFilter}`));
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const facts = readBoardFacts(storeRoot, {
      ...(repoFilter !== undefined ? { repo: repoFilter } : {}),
      ...(input.topic !== undefined ? { topic: input.topic } : {}),
      ...(statusFilter !== undefined ? { status: statusFilter } : {}),
    });

    if (input.json) {
      input.stdout(JSON.stringify(facts, null, 2));
      return 0;
    }

    if (facts.length === 0) {
      input.stdout("board: 0 facts");
      input.stdout("no facts");
      return 0;
    }

    input.stdout(`board (${facts.length})`);
    input.stdout("id | topic | status | confidence | repo | expiresAt");
    input.stdout("---|-------|--------|------------|------|----------");
    for (const f of facts) {
      input.stdout(
        `${f.id} | ${f.topic} | ${f.status} | ${f.confidence} | ${f.scope.repoKey} | ${f.expiresAt ?? "-"}`,
      );
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const boardListCommand = defineCommand({
  meta: { name: "list", description: "List board facts (filtered by repo/topic/status)." },
  args: {
    repo: { type: "string", description: "Filter by repo key." },
    topic: { type: "string", description: "Filter by topic (normalized)." },
    status: { type: "string", description: "Filter by status: active|disputed|resolved." },
    all: { type: "boolean", default: false, description: "Show facts from all repos." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runBoardList({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      repo:
        typeof (args as { repo?: unknown }).repo === "string"
          ? ((args as { repo: string }).repo as string)
          : undefined,
      topic:
        typeof (args as { topic?: unknown }).topic === "string"
          ? ((args as { topic: string }).topic as string)
          : undefined,
      status:
        typeof (args as { status?: unknown }).status === "string"
          ? ((args as { status: string }).status as string)
          : undefined,
      all: Boolean((args as { all?: unknown }).all),
      json: Boolean((args as { json?: unknown }).json),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
