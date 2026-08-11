import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { captureGitState } from "../../preflight/git-capture.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { rankResidue } from "../../sweep/rank.js";
import { findProjectByCwd } from "../warmup.js";

function walkFiles(root: string, dir: string, out: string[], depth = 0): void {
  if (depth > 6) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (
      name === ".git" ||
      name === ".megasaver" ||
      name === "node_modules" ||
      name === "dist" ||
      name === ".turbo"
    )
      continue;
    const abs = join(dir, name);
    try {
      const st = statSync(abs);
      if (st.isDirectory()) walkFiles(root, abs, out, depth + 1);
      else if (st.isFile()) out.push(relative(root, abs));
    } catch {}
  }
}

export type RunSweepScanInput = {
  cwd: string;
  home: string;
  storeFlag: string | undefined;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSweepScan(input: RunSweepScanInput): Promise<0 | 1> {
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
    const normalizedProjects = projects.map((pr) => {
      try {
        return { ...pr, rootPath: realpathSync(pr.rootPath) };
      } catch {
        return pr;
      }
    });
    const projectReal = findProjectByCwd(normalizedProjects as never, cwdReal);
    const project = projectReal ? (projects.find((pr) => pr.id === projectReal.id) ?? null) : null;
    if (!project) {
      input.stderr("error: no registered project for this workspace; run mega project create");
      return 1;
    }
    const git = await captureGitState(project.rootPath, { timeoutMs: 2000 });
    const untrackedEntries = git.untracked.map((p) => {
      try {
        const st = statSync(join(project.rootPath, p));
        return { relPath: p, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return { relPath: p, size: 0, mtimeMs: Date.now() };
      }
    });
    // also add staged/unstaged as potential residue? For now untracked only
    const walked: string[] = [];
    walkFiles(project.rootPath, project.rootPath, walked);
    // walked includes untracked already, but we rank them
    const ranked = rankResidue(untrackedEntries);
    if (input.json) {
      input.stdout(JSON.stringify({ ranked, gitAvailable: git.available }, null, 2));
    } else {
      if (ranked.length === 0) {
        input.stdout("no residue found");
      } else {
        for (const r of ranked.slice(0, 100)) {
          input.stdout(`${r.bucket}  ${r.relPath}  ${r.size}B`);
        }
        if (ranked.length > 100) input.stdout(`... +${ranked.length - 100} more`);
      }
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode as 0 | 1;
  }
}

export const sweepScanCommand = defineCommand({
  meta: { name: "scan", description: "Scan for residue (tmp, cache, build-output, agent-draft)." },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const code = await runSweepScan({
      ...env,
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
