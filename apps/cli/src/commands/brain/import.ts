import { type KeyObject, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
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

export const BRAIN_IMPORT_UPSELL = `Brain import is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;

export type RunBrainImportInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  projectName: string;
  filePath: string;
  json: boolean;
  /** Override for tests; defaults to MAX_BUNDLE_BYTES. */
  maxBundleBytes?: number;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  ensureStore: () => Promise<EnsureStoreReadyResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runBrainImport(input: RunBrainImportInput): Promise<0 | 1> {
  const ent = checkEntitlement("brain-portability", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(BRAIN_IMPORT_UPSELL);
    return 0;
  }

  const cap = input.maxBundleBytes ?? MAX_BUNDLE_BYTES;
  let bundleText: string;
  try {
    // ponytail: TOCTOU — file could grow between stat and read; acceptable for a
    // local single-user CLI, tighten (stream + byte-count) if this ever fronts a network boundary.
    if (statSync(input.filePath).size > cap) {
      input.stderr(`error: bundle exceeds ${cap} bytes`);
      return 1;
    }
    bundleText = readFileSync(input.filePath, "utf8");
  } catch {
    input.stderr(`error: cannot read bundle at ${input.filePath}`);
    return 1;
  }

  // Lazy import after the gate: never load core's brain bundler on the free path.
  const { BrainBundleError, importBrain } = await import("@megasaver/core");
  const { registry } = await input.ensureStore();
  const project = registry.listProjects().find((p) => p.name === input.projectName);
  if (project === undefined) {
    const { message } = projectNotFoundMessage(input.projectName);
    input.stderr(message);
    return 1;
  }

  try {
    const report = importBrain({
      registry,
      projectId: project.id,
      bundleText,
      newId: input.newId ?? randomUUID,
    });
    if (input.json) {
      input.stdout(JSON.stringify({ status: "imported", ...report }));
      return 0;
    }
    input.stdout(
      `imported memories ${report.imported.memories} | rules ${report.imported.rules} | failures ${report.imported.failures} (skipped ${report.skipped.memories}/${report.skipped.rules}/${report.skipped.failures}) from ${report.sourceProject.name}`,
    );
    input.stdout("imported memories are suggested — run: mega memory approve");
    return 0;
  } catch (error) {
    if (error instanceof BrainBundleError) {
      input.stderr(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

export const brainImportCommand = defineCommand({
  meta: {
    name: "import",
    description: "Import a .megabrain bundle as suggested knowledge (Mega Saver Pro).",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Target project name." },
    file: { type: "positional", required: true, description: "Path to the .megabrain bundle." },
    json: { type: "boolean", default: false, description: "Emit the import report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runBrainImport({
      storeRoot,
      now: () => Date.now(),
      projectName: String(args.projectName),
      filePath: String(args.file),
      json: !!args.json,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
