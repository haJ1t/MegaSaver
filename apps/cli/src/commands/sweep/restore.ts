import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readQuarantineManifest, restoreQuarantine } from "../../sweep/quarantine.js";
import { findProjectByCwd } from "../warmup.js";

export type RunSweepRestoreInput = {
  cwd: string;
  home: string;
  storeFlag: string | undefined;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  id: string | undefined;
  last: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSweepRestore(input: RunSweepRestoreInput): Promise<0 | 1> {
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
    let id = input.id;
    if (input.last || !id) {
      try {
        const idxPath = join(project.rootPath, ".megasaver", "quarantine-index.json");
        const ids: string[] = JSON.parse(readFileSync(idxPath, "utf8"));
        id = ids[0];
      } catch {}
    }
    if (!id) {
      input.stderr("error: no quarantine id provided and no index found");
      return 1;
    }
    const manifest = readQuarantineManifest(project.rootPath, id);
    if (!manifest) {
      input.stderr(`error: quarantine "${id}" not found`);
      return 1;
    }
    const result = restoreQuarantine({ repoRoot: project.rootPath, manifest });
    input.stdout(`restored ${result.moved} files`);
    if (result.skipped.length > 0) {
      for (const s of result.skipped) input.stderr(`skipped ${s.path}: ${s.reason}`);
      return 1;
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode as 0 | 1;
  }
}

export const sweepRestoreCommand = defineCommand({
  meta: { name: "restore", description: "Restore a quarantine by id (collision-safe)." },
  args: {
    id: { type: "positional", required: false, description: "Quarantine id." },
    last: { type: "boolean", default: false, description: "Restore last quarantine." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const code = await runSweepRestore({
      ...env,
      id: typeof args.id === "string" ? args.id : undefined,
      last: !!args.last,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
