import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPreflightFilename, readPreflightSnapshot } from "@megasaver/content-store";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import {
  type PreflightSnapshot,
  comparePreflightSnapshots,
  renderPreflightDiff,
} from "../../preflight/snapshot.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

function findPreflightFile(
  storeRoot: string,
  project: { id: string; rootPath: string },
  snapshotId: string,
): string | null {
  if (!/^preflight-\d+-[a-z0-9]{6}$/.test(snapshotId)) return null;
  const candidates = [
    join(storeRoot, "content", project.id, "__preflight__", `${snapshotId}.json`),
  ];
  // Also try workspace-scoped
  // workspaceKey is needed but we don't have it here; brute scan content dirs
  for (const c of candidates) {
    try {
      readFileSync(c, "utf8");
      return c;
    } catch {}
  }
  // Brute scan: search content/<project.id> and content/<workspaceKey>
  // Fallback: scan all content dirs for matching filename
  try {
    const contentRoot = join(storeRoot, "content");
    for (const top of readdirSync(contentRoot)) {
      const topPath = join(contentRoot, top);
      try {
        if (!statSync(topPath).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const sess of readdirSync(topPath)) {
        const sessPath = join(topPath, sess);
        try {
          if (!statSync(sessPath).isDirectory()) continue;
        } catch {
          continue;
        }
        const p = join(sessPath, `${snapshotId}.json`);
        try {
          readFileSync(p, "utf8");
          return p;
        } catch {}
      }
    }
  } catch {}
  return null;
}

function listRecentSnapshots(storeRoot: string, project: { id: string }): PreflightSnapshot[] {
  const dir = join(storeRoot, "content", project.id, "__preflight__");
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const snaps: PreflightSnapshot[] = [];
  for (const name of names) {
    if (!isPreflightFilename(name)) continue;
    const p = join(dir, name);
    const s = readPreflightSnapshot(p);
    if (s) snaps.push(s);
  }
  snaps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return snaps;
}

export type RunPreflightDiffInput = {
  cwd: string;
  home: string;
  storeFlag: string | undefined;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  a: string | undefined;
  b: string | undefined;
  last: boolean;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runPreflightDiff(input: RunPreflightDiffInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    storeRoot = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode as 0 | 1;
  }

  try {
    const { registry } = await ensureStoreReady(storeRoot);
    let cwdReal = input.cwd;
    try {
      cwdReal = realpathSync(input.cwd);
    } catch {}
    const projects = registry.listProjects();
    const normalizedProjects = projects.map((p) => {
      try {
        return { ...p, rootPath: realpathSync(p.rootPath) };
      } catch {
        return p;
      }
    });
    const projectReal = findProjectByCwd(normalizedProjects as never, cwdReal);
    const project = projectReal ? (projects.find((p) => p.id === projectReal.id) ?? null) : null;
    if (!project) {
      input.stderr("error: no registered project for this workspace; run mega project create");
      return 1;
    }

    let snapA: PreflightSnapshot | null = null;
    let snapB: PreflightSnapshot | null = null;

    if (input.last) {
      const recent = listRecentSnapshots(storeRoot, project);
      if (recent.length < 2) {
        input.stderr("error: need two snapshots to diff");
        return 1;
      }
      snapA = recent[1] ?? null;
      snapB = recent[0] ?? null;
    } else {
      if (!input.a || !input.b) {
        input.stderr("error: pass two snapshot ids or --last");
        return 1;
      }
      const pathA = findPreflightFile(storeRoot, project, input.a);
      const pathB = findPreflightFile(storeRoot, project, input.b);
      if (!pathA) {
        input.stderr(`error: snapshot "${input.a}" not found`);
        return 1;
      }
      if (!pathB) {
        input.stderr(`error: snapshot "${input.b}" not found`);
        return 1;
      }
      snapA = readPreflightSnapshot(pathA);
      snapB = readPreflightSnapshot(pathB);
      if (!snapA || !snapB) {
        input.stderr("error: snapshot unreadable");
        return 1;
      }
    }

    if (!snapA || !snapB) {
      input.stderr("error: snapshot not found");
      return 1;
    }

    const diff = comparePreflightSnapshots(snapA, snapB);
    if (input.json) {
      input.stdout(JSON.stringify(diff, null, 2));
    } else {
      input.stdout(renderPreflightDiff(diff));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode as 0 | 1;
  }
}

export const preflightDiffCommand = defineCommand({
  meta: { name: "diff", description: "Diff two preflight snapshots." },
  args: {
    a: { type: "positional", required: false, description: "First snapshot id." },
    b: { type: "positional", required: false, description: "Second snapshot id." },
    last: { type: "boolean", default: false, description: "Diff the last two snapshots." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const code = await runPreflightDiff({
      ...env,
      a: typeof args.a === "string" ? args.a : undefined,
      b: typeof args.b === "string" ? args.b : undefined,
      last: !!args.last,
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
