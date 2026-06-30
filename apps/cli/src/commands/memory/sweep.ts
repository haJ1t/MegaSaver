import { sweepMemoryTiers } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";

export type RunMemorySweepInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  // Single pinned instant for both the archival policy (asOf) and the row's
  // updatedAt, so a sweep is deterministic and tests can fix time.
  now?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// Deterministic, on-demand tier sweep (the memory analog of `mega memory index`):
// demote aged-out / closed / low-value memories to the `archival` tier so they
// drop out of default recall. The ONLY mutation in the M2 tier system — lossless
// (sets tier, never deletes) and idempotent (already-archival rows are skipped by
// the planner). No background process.
export async function runMemorySweep(input: RunMemorySweepInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
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
    return cli.exitCode;
  }

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const now = input.now ?? readTestEnv("MEGA_TEST_NOW") ?? new Date().toISOString();
    const entries = registry.listMemoryEntries(project.id);
    const { archiveIds } = sweepMemoryTiers(entries, now);
    for (const id of archiveIds) {
      registry.updateMemoryEntry(id, { tier: "archival", updatedAt: now });
    }

    const summary = { archived: archiveIds.length, scanned: entries.length };
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(summary));
    } else {
      input.stdout(`archived=${summary.archived} scanned=${summary.scanned}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memorySweepCommand = defineCommand({
  meta: {
    name: "sweep",
    description: "Archive aged-out/low-value memories (tier sweep). On-demand, lossless.",
  },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemorySweep({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
