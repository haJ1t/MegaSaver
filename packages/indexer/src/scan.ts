import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignoreFactory from "ignore";

// `ignore` is a CJS `export =` module; under NodeNext its default-import type
// is not seen as callable. Cast the factory to the minimal structural surface
// we use (runtime value is the real callable under esModuleInterop).
interface IgnoreMatcher {
  add(pattern: string | readonly string[]): IgnoreMatcher;
  ignores(path: string): boolean;
}
const createIgnore = ignoreFactory as unknown as () => IgnoreMatcher;

export type SkipReason = "secret" | "binary" | "too-large" | "symlink";
export type ScannedFile = { path: string; size: number; language: string; mtimeIso: string };
export type SkippedFile = { path: string; reason: SkipReason };
export type ScanResult = { rootDir: string; files: ScannedFile[]; skipped: SkippedFile[] };
export type ScanOptions = { rootDir: string; maxFileSize?: number };

const DEFAULT_MAX_FILE_SIZE = 1_000_000;
const ALWAYS_IGNORE = ["node_modules/", "dist/", ".git/", ".turbo/"];
// Never inventory secret-bearing files. Filename-based: content lives only in
// blocks (Task 5 redacts there); a secret FILE should not even be listed.
const SECRET_RE = /(^|\/)(\.env(\..+)?|.+\.pem|.+\.key|id_rsa)$/;
const BINARY_SNIFF_BYTES = 8000;

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  md: "markdown",
  json: "json",
  py: "python",
  go: "go",
};

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function languageOf(path: string): string {
  const ext = path.includes(".") ? (path.split(".").pop() ?? "") : "";
  return LANGUAGE_BY_EXT[ext.toLowerCase()] ?? "other";
}

function isBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

// Read-only, traversal-safe repo walk. Symlinks are never followed (escape and
// cycle safe). Honors always-ignore + .gitignore + .megaignore, skips secret /
// binary / oversized files. Returns a deterministic (sorted) inventory.
export function scanRepo(options: ScanOptions): ScanResult {
  const { rootDir } = options;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  const ig = createIgnore().add(ALWAYS_IGNORE);
  for (const ignoreFile of [".gitignore", ".megaignore"]) {
    try {
      ig.add(readFileSync(join(rootDir, ignoreFile), "utf8"));
    } catch {
      // absent ignore file — nothing to add
    }
  }

  const files: ScannedFile[] = [];
  const skipped: SkippedFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(rootDir, abs));
      if (rel.length === 0) continue;

      if (entry.isSymbolicLink()) {
        skipped.push({ path: rel, reason: "symlink" });
        continue;
      }
      if (entry.isDirectory()) {
        if (!ig.ignores(`${rel}/`)) walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;

      if (SECRET_RE.test(rel)) {
        skipped.push({ path: rel, reason: "secret" });
        continue;
      }
      // ignored files are common and noisy — dropped silently, not recorded.
      if (ig.ignores(rel)) continue;

      const stats = statSync(abs);
      if (stats.size > maxFileSize) {
        skipped.push({ path: rel, reason: "too-large" });
        continue;
      }
      if (isBinary(readFileSync(abs))) {
        skipped.push({ path: rel, reason: "binary" });
        continue;
      }
      files.push({
        path: rel,
        size: stats.size,
        language: languageOf(rel),
        mtimeIso: stats.mtime.toISOString(),
      });
    }
  };

  walk(rootDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { rootDir, files, skipped };
}
