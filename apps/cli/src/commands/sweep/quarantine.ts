import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { quarantineFiles } from "../../sweep/quarantine.js";
import { findProjectByCwd } from "../warmup.js";

export type RunSweepQuarantineInput = {
  cwd: string;
  home: string;
  storeFlag: string | undefined;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  paths: string[];
  dryRun: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSweepQuarantine(input: RunSweepQuarantineInput): Promise<0 | 1> {
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
    const project = findProjectByCwd(registry.listProjects(), input.cwd);
    if (!project) {
      input.stderr(`error: no registered project for this workspace; run mega project create`);
      return 1;
    }
    if (input.paths.length === 0) {
      input.stderr(`error: provide paths to quarantine or use mega sweep scan`);
      return 1;
    }
    if (input.dryRun) {
      input.stdout(`dry-run: would quarantine ${input.paths.length} files:`);
      for (const p of input.paths) input.stdout(`  ${p}`);
      return 0;
    }
    const manifest = quarantineFiles({
      repoRoot: project.rootPath,
      entries: input.paths.map((p) => ({ relPath: p })),
      snapshotId: null,
      now: () => Date.now(),
    });
    input.stdout(
      `quarantined ${manifest.entries.length} files -> .megasaver/quarantine/${manifest.id}`,
    );
    input.stdout(`manifest: .megasaver/quarantine/${manifest.id}/manifest.json`);
    input.stdout(`undo: .megasaver/quarantine/${manifest.id}/undo.sh`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode as 0 | 1;
  }
}

export const sweepQuarantineCommand = defineCommand({
  meta: {
    name: "quarantine",
    description: "Move selected residue to .megasaver/quarantine/ (never delete).",
  },
  args: {
    paths: { type: "positional", required: false, description: "Relative paths to quarantine." },
    "dry-run": { type: "boolean", default: false, description: "Preview without moving." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const raw = args.paths;
    const paths: string[] = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === "string"
        ? [raw]
        : [];
    const code = await runSweepQuarantine({
      ...env,
      paths,
      dryRun: !!args["dry-run"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
