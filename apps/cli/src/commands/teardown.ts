import type { KeyObject } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  type FixMemoryFileReader,
  type FixSaverReader,
  PRO_ANALYTICS_URL,
  type SavingsEventReader,
  defaultMemoryFileReader,
  defaultSaverReader,
  defaultSavingsEventReader,
} from "./savings/index.js";

// teardown-specific upsell: the shared string says "historical savings
// analytics", which would misname this feature. Same activation mechanics.
export const TEARDOWN_UPSELL = `The waste teardown is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type TeardownWriteFile = (path: string, content: string) => void;
export type TeardownFileExists = (path: string) => boolean;

export function defaultTeardownFs(): {
  writeFile: TeardownWriteFile;
  fileExists: TeardownFileExists;
} {
  return {
    writeFile: (path, content) => writeFileSync(path, content),
    fileExists: (path) => existsSync(path),
  };
}

export type RunTeardownInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  readSaver: FixSaverReader;
  readMemoryFileSizes: FixMemoryFileReader;
  outDir: string;
  force?: boolean;
  json?: boolean;
  writeFile: TeardownWriteFile;
  fileExists: TeardownFileExists;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runTeardown(input: RunTeardownInput): Promise<0 | 1> {
  // The entitlement gate runs FIRST — on the free path nothing is read,
  // composed, or written, whatever flags are set (spy-enforced).
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(TEARDOWN_UPSELL);
    return 0;
  }

  const { composeTeardown, renderTeardownCardSvg, renderTeardownMarkdown } = await import(
    "@megasaver/pro-analytics"
  );
  const { events } = await input.readAllEvents();
  const report = composeTeardown(events, {
    saver: input.readSaver(),
    memoryFiles: input.readMemoryFileSizes(),
  });

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  const mdPath = join(input.outDir, "teardown.md");
  const svgPath = join(input.outDir, "teardown.svg");
  // Check BOTH before writing EITHER: a partial exposé is worse than none.
  const existing = [mdPath, svgPath].filter((p) => input.fileExists(p));
  if (existing.length > 0 && input.force !== true) {
    input.stderr(`refusing to overwrite ${existing.join(", ")} (use --force)`);
    return 1;
  }

  input.writeFile(mdPath, renderTeardownMarkdown(report));
  input.writeFile(svgPath, renderTeardownCardSvg(report));
  input.stdout(`wrote ${mdPath}`);
  input.stdout(`wrote ${svgPath}`);
  input.stdout("Share-safe by construction: generic source names and numbers only.");
  return 0;
}

export const teardownCommand = defineCommand({
  meta: {
    name: "teardown",
    description:
      "Compose a share-safe waste exposé (md + SVG card) from recorded events (Mega Saver Pro).",
  },
  args: {
    out: { type: "string", description: "Output directory (default: current directory)." },
    force: { type: "boolean", default: false, description: "Overwrite existing teardown files." },
    json: { type: "boolean", default: false, description: "Emit the report as JSON (no files)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const cwd = process.cwd();
    const fs = defaultTeardownFs();
    const code = await runTeardown({
      storeRoot,
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(storeInput),
      readSaver: defaultSaverReader(storeRoot, cwd),
      readMemoryFileSizes: defaultMemoryFileReader(cwd),
      outDir: typeof args.out === "string" ? resolve(args.out) : cwd,
      force: !!args.force,
      json: !!args.json,
      writeFile: fs.writeFile,
      fileExists: fs.fileExists,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
