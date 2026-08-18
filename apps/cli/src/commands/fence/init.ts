import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type DeriveSeams,
  appendFenceEntries,
  createDefaultDeriveSeams,
  deriveFence,
  loadFenceFile,
  writeFenceFileAtomic,
} from "@megasaver/fence";
import { defineCommand } from "citty";

function findFenceInitRoot(cwd: string): string {
  let curr = cwd;
  while (true) {
    if (existsSync(join(curr, ".git")) || existsSync(join(curr, "fence.yaml"))) {
      return curr;
    }
    const parent = dirname(curr);
    if (parent === curr) {
      return cwd;
    }
    curr = parent;
  }
}

export type RunFenceInitInput = {
  cwd: string;
  write: boolean;
  seams?: DeriveSeams | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runFenceInit(input: RunFenceInitInput): Promise<0 | 1> {
  const root = findFenceInitRoot(input.cwd);

  let existing: ReturnType<typeof loadFenceFile> = null;
  try {
    existing = loadFenceFile(root);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    input.stderr(`failed to parse existing fence.yaml: ${message}`);
    return 1;
  }

  const seams = input.seams ?? createDefaultDeriveSeams(root);
  let derived: ReturnType<typeof deriveFence>;
  try {
    derived = deriveFence(seams);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    input.stderr(`derivation failed: ${message}`);
    return 1;
  }

  if (existing === null) {
    for (const entry of derived.file.entries) {
      input.stdout(`${entry.path}  ${entry.class}  ${entry.reason}`);
    }
    for (const sk of derived.skipped) {
      input.stdout(`skipped: ${sk.pattern} — ${sk.reason}`);
    }
    if (derived.degradedSignals.length > 0) {
      input.stdout(`no git — skipped signals: ${derived.degradedSignals.join(", ")}`);
    }
    if (input.write) {
      try {
        writeFenceFileAtomic(root, derived.file);
        input.stdout(`wrote ${join(root, "fence.yaml")}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        input.stderr(`failed to write fence.yaml: ${message}`);
        return 1;
      }
    }
    return 0;
  }

  const existingPaths = new Set(existing.entries.map((e) => e.path));
  const additions = derived.file.entries.filter((e) => !existingPaths.has(e.path));

  if (additions.length === 0) {
    input.stdout("no new entries");
  } else {
    input.stdout("suggested additions:");
    for (const entry of additions) {
      input.stdout(`${entry.path}  ${entry.class}  ${entry.reason}`);
    }
  }

  for (const sk of derived.skipped) {
    input.stdout(`skipped: ${sk.pattern} — ${sk.reason}`);
  }
  if (derived.degradedSignals.length > 0) {
    input.stdout(`no git — skipped signals: ${derived.degradedSignals.join(", ")}`);
  }

  if (input.write && additions.length > 0) {
    try {
      appendFenceEntries(root, additions);
      input.stdout(`appended ${additions.length} entries to ${join(root, "fence.yaml")}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      input.stderr(`failed to append fence.yaml: ${message}`);
      return 1;
    }
  }

  return 0;
}

export const fenceInitCommand = defineCommand({
  meta: {
    name: "init",
    description: "Derive and initialize fence.yaml",
  },
  args: {
    write: {
      type: "boolean",
      description: "Write derived entries to fence.yaml",
      default: false,
    },
  },
  async run({ args }) {
    const code = await runFenceInit({
      cwd: process.cwd(),
      write: Boolean(args.write),
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exit(code);
  },
});
