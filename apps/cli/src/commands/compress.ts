import { execFileSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { checkEntitlement } from "@megasaver/entitlement";
import { compressProse } from "@megasaver/output-filter";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

export const COMPRESS_UPSELL = `Reversible memory-file compression is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".mdc"]);

const IS_WIN32 = process.platform === "win32";

export type GitFileStatus = "clean" | "dirty" | "untracked" | "unknown";

export type CompressFs = {
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  backupFile: (src: string, dest: string) => void;
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

// Durability for the temp→rename atomic write: fsync the temp file's bytes to
// disk, rename it over the destination, then fsync the parent directory so the
// rename link survives power-loss (POSIX ext4/xfs/APFS). Windows/NTFS journals
// the rename and a directory flush is a documented no-op (opening a dir for
// fsync also fails there), so the dir fsync is POSIX-only. A dir fsync that
// fails AFTER a successful rename is a durability hint, not a correctness gate —
// the file already landed, so swallow it. Open the temp "r+" because Windows
// FlushFileBuffers needs a write-capable handle. Mirrors content-store's
// atomicWriteFile.
function fsyncedRename(tempPath: string, destPath: string): void {
  try {
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, destPath);
  } catch (error) {
    // Pre-rename failure — dest and the original are untouched. Drop the orphan
    // temp so a failed run leaves no hidden .tmp behind (matches content-store).
    rmSync(tempPath, { force: true });
    throw error;
  }
  if (IS_WIN32) return;
  try {
    const dirFd = openSync(dirname(destPath), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Rename already committed the file; the parent-dir fsync is a durability
    // hint only, so a failure here must not fail the write.
  }
}

export function defaultCompressFs(): CompressFs {
  return {
    readFile: (path) => readFileSync(path, "utf8"),
    fileExists: (path) => existsSync(path),
    // Atomic + durable: write a temp in the SAME directory (rename is only
    // atomic within a filesystem), then fsync + rename over the target. Preserve
    // the target's existing mode — --apply changes content, not permissions, so a
    // private (0o600/0o400) memory file stays private.
    writeFile: (path, content) => {
      const mode = existsSync(path) ? statSync(path).mode : undefined;
      const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
      writeFileSync(tmp, content);
      fsyncedRename(tmp, path);
      if (mode !== undefined) {
        try {
          chmodSync(path, mode);
        } catch {
          // Best-effort: bytes already committed; the mode restore is cosmetic.
        }
      }
    },
    // Byte-exact copy of the ORIGINAL file — NOT a utf8 decode→encode round trip,
    // which replaces invalid bytes with U+FFFD and corrupts the backup of any
    // non-UTF-8 source, breaking mv-restore. Same atomic + durable temp→rename.
    backupFile: (src, dest) => {
      const tmp = join(dirname(dest), `.${basename(dest)}.${process.pid}.tmp`);
      copyFileSync(src, tmp);
      // copyFileSync preserves the source mode; a read-only source would make the
      // temp read-only and fail fsync's "r+" open. Make the temp writable for the
      // fsync, then restore the source mode so the .bak stays a byte- AND
      // mode-exact pristine copy.
      const srcMode = statSync(src).mode;
      chmodSync(tmp, 0o600);
      fsyncedRename(tmp, dest);
      try {
        chmodSync(dest, srcMode);
      } catch {
        // Best-effort: the byte-exact backup already committed; mode is cosmetic.
      }
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

  let original: string;
  try {
    original = input.fs.readFile(input.path);
  } catch {
    input.stderr(`cannot read ${input.path}: not a readable file`);
    return 1;
  }
  const compressed = compressProse(original);
  const { composeCompressionReport, renderCompressionSummary } = await import(
    "@megasaver/pro-analytics"
  );
  const report = composeCompressionReport(original, compressed);
  // Only a real byte reduction is worth writing: the engine can emit markers
  // longer than a short body, so report.changed can be true with no savings.
  const worthwhile = report.changed && report.compressedBytes < report.originalBytes;

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (input.apply !== true) {
    if (!worthwhile) {
      input.stdout("already tight — nothing to compress");
      return 0;
    }
    input.stdout(renderCompressionSummary(report));
    input.stdout("Lossy: paragraph bodies and list tails become markers.");
    input.stdout(`Re-run with --apply to overwrite (a ${input.path}.bak backup is written first).`);
    return 0;
  }

  if (!worthwhile) {
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

  input.fs.backupFile(input.path, bak);
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
