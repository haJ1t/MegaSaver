import { type KeyObject, randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { projectNotFoundMessage } from "../../errors.js";
import {
  type EnsureStoreReadyResult,
  ensureStoreReady,
  readStoreEnv,
  resolveStorePath,
} from "../../store.js";
import { PRO_ANALYTICS_URL } from "../savings/index.js";

export const BRAIN_EXPORT_UPSELL = `Brain export is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type RunBrainExportInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  projectName: string;
  outPath?: string;
  json: boolean;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function defaultFileName(projectName: string, nowMs: number): string {
  const d = new Date(nowMs);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${projectName}-${ymd}.megabrain`;
}

export async function runBrainExport(input: RunBrainExportInput): Promise<0 | 1> {
  const ent = checkEntitlement("brain-portability", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(BRAIN_EXPORT_UPSELL);
    return 0;
  }

  // Lazy import after the gate: never load core's brain bundler on the free path.
  const { exportBrain, parseBrainBundle } = await import("@megasaver/core");
  const { registry } = await input.ensureStore();
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    const { message } = projectNotFoundMessage(input.projectName);
    input.stderr(message);
    return 1;
  }

  const text = exportBrain({
    registry,
    projectId: project.id,
    createdAt: new Date(input.now()).toISOString(),
  });
  const path = resolve(input.outPath ?? defaultFileName(input.projectName, input.now()));
  const tmp = join(dirname(path), `.${randomUUID()}.megabrain.tmp`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // tmp may not exist
    }
    input.stderr(`error: cannot write bundle to ${path}`);
    return 1;
  }
  const { manifest } = parseBrainBundle(text);

  if (input.json) {
    input.stdout(
      JSON.stringify({
        status: "exported",
        path,
        counts: manifest.counts,
        redactionFindings: manifest.redactionFindings,
      }),
    );
    return 0;
  }
  input.stdout(`exported ${path}`);
  input.stdout(
    `memories ${manifest.counts.memories} | rules ${manifest.counts.rules} | failures ${manifest.counts.failures} | redactions ${manifest.redactionFindings}`,
  );
  return 0;
}

export const brainExportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Export the project knowledge layer to a .megabrain bundle (Mega Saver Pro).",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    out: {
      type: "string",
      description: "Output file path (default <project>-<YYYYMMDD>.megabrain).",
    },
    json: { type: "boolean", default: false, description: "Emit the export report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runBrainExport({
      storeRoot,
      now: () => Date.now(),
      projectName: String(args.projectName),
      ...(typeof args.out === "string" ? { outPath: args.out } : {}),
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
