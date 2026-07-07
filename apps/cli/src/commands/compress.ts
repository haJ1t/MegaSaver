import { execFileSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { checkEntitlement } from "@megasaver/entitlement";
import { compressProse } from "@megasaver/output-filter";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

export const COMPRESS_UPSELL = `Reversible memory-file compression is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".mdc"]);

export type GitFileStatus = "clean" | "dirty" | "untracked" | "unknown";

export type CompressFs = {
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  gitFileStatus: (path: string) => GitFileStatus;
};

function defaultGitFileStatus(path: string): GitFileStatus {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", path], {
      cwd: dirname(path),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim() === "") return "clean";
    if (out.startsWith("??")) return "untracked";
    return "dirty";
  } catch {
    return "unknown";
  }
}

export function defaultCompressFs(): CompressFs {
  return {
    readFile: (path) => readFileSync(path, "utf8"),
    fileExists: (path) => existsSync(path),
    // Atomic: temp file in the SAME directory (rename is only atomic within a
    // filesystem), then rename over the target. Mirrors hooks/intent-run.ts.
    writeFile: (path, content) => {
      const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
      writeFileSync(tmp, content);
      renameSync(tmp, path);
    },
    gitFileStatus: (path) => defaultGitFileStatus(path),
  };
}

export type RunCompressInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  path: string;
  apply?: boolean;
  force?: boolean;
  json?: boolean;
  fs: CompressFs;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runCompress(input: RunCompressInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(COMPRESS_UPSELL);
    return 0;
  }

  if (!ALLOWED_EXTENSIONS.has(extname(input.path).toLowerCase())) {
    input.stderr("mega compress only accepts .md, .txt, or .mdc files");
    return 1;
  }

  if (!input.fs.fileExists(input.path)) {
    input.stderr(`no such file: ${input.path}`);
    return 1;
  }

  const original = input.fs.readFile(input.path);
  const compressed = compressProse(original);
  const { composeCompressionReport, renderCompressionSummary } = await import(
    "@megasaver/pro-analytics"
  );
  const report = composeCompressionReport(original, compressed);

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (input.apply !== true) {
    if (!report.changed) {
      input.stdout("already tight — nothing to compress");
      return 0;
    }
    input.stdout(renderCompressionSummary(report));
    input.stdout("Lossy: paragraph bodies and list tails become markers.");
    input.stdout(`Re-run with --apply to overwrite (a ${input.path}.bak backup is written first).`);
    return 0;
  }

  if (!report.changed) {
    input.stdout("already tight — nothing to compress; not writing");
    return 0;
  }

  if (input.fs.gitFileStatus(input.path) === "dirty" && input.force !== true) {
    input.stderr(`${input.path} has uncommitted changes — commit them or re-run with --force`);
    return 1;
  }

  const bak = `${input.path}.bak`;
  // Write-once: never overwrite an existing backup, even with --force. It holds the
  // one pristine pre-compress copy, and compressProse is NOT idempotent — a --force
  // re-run would read the already-compressed file and clobber the pristine .bak with
  // degraded content, destroying the original. Refuse; make the user restore or
  // remove the backup deliberately instead.
  if (input.fs.fileExists(bak)) {
    input.stderr(
      `backup already exists: ${bak} — restore it (mv ${bak} ${input.path}) or remove it before compressing again`,
    );
    return 1;
  }

  input.fs.writeFile(bak, original);
  input.fs.writeFile(input.path, report.compressed);
  input.stdout(
    `compressed ${input.path}: ${report.bytesSaved} bytes (~${report.tokensSaved} tokens, ~$${report.dollarsSaved.toFixed(2)} est.) saved`,
  );
  input.stdout(`backed up to ${bak}`);
  input.stdout(`restore with: mv ${bak} ${input.path}`);
  return 0;
}

export const compressCommand = defineCommand({
  meta: {
    name: "compress",
    description:
      "Compress a memory/doc file with the extractive prose engine — dry-run by default, reversible on --apply (Mega Saver Pro).",
  },
  args: {
    path: {
      type: "positional",
      required: true,
      description: "File to compress (.md, .txt, or .mdc).",
    },
    apply: {
      type: "boolean",
      default: false,
      description: "Overwrite the file (a <path>.bak backup is written first).",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Override the git-dirty guard (the write-once backup is never overwritten).",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit the CompressionReport as JSON (never writes).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runCompress({
      storeRoot,
      now: () => Date.now(),
      path: resolve(String(args.path)),
      apply: !!args.apply,
      force: !!args.force,
      json: !!args.json,
      fs: defaultCompressFs(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
