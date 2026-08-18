import { type FenceEntry, type FenceFile, parseFenceFile } from "./fence-file.js";
import { type SkippedGitattributesPattern, translateGitattributes } from "./gitattributes.js";

export const LOCKFILE_BASENAMES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "gradle.lockfile",
  "flake.lock",
] as const;

export const BUILD_OUTPUT_DIRS = [
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "dist-bundle",
] as const;

export const VENDORED_DIRS = ["vendor", "third_party"] as const;

export const CODEGEN_HEADER_LITERALS = [
  "@generated",
  "DO NOT EDIT",
  "AUTO-GENERATED FILE",
] as const;

export type DeriveSeams = {
  listTrackedFiles: () => readonly string[] | null; // null = no git
  readFileHead: (relPath: string) => string | null; // first 2 KiB; null = unreadable or file > 1 MiB
  dirExists: (relPath: string) => boolean;
  readGitattributes: () => string | null;
};

export type DeriveResult = {
  file: FenceFile;
  skipped: readonly SkippedGitattributesPattern[];
  degradedSignals: readonly string[];
};

export function deriveFence(seams: DeriveSeams): DeriveResult {
  const entriesMap = new Map<string, FenceEntry>();
  const skipped: SkippedGitattributesPattern[] = [];
  const degradedSignals: string[] = [];

  const addEntry = (entry: FenceEntry): void => {
    if (!entriesMap.has(entry.path)) {
      entriesMap.set(entry.path, entry);
    }
  };

  const tracked = seams.listTrackedFiles();

  // (a) Lockfiles
  if (tracked !== null) {
    const trackedSet = new Set(tracked);
    for (const lock of LOCKFILE_BASENAMES) {
      if (trackedSet.has(lock)) {
        addEntry({
          path: lock,
          class: "lockfile",
          reason: "derived: lockfile basename",
        });
      }
    }
  } else {
    for (const lock of LOCKFILE_BASENAMES) {
      if (seams.readFileHead(lock) !== null) {
        addEntry({
          path: lock,
          class: "lockfile",
          reason: "derived: lockfile basename",
        });
      }
    }
  }

  // (b) Build output dirs
  for (const dir of BUILD_OUTPUT_DIRS) {
    if (seams.dirExists(dir)) {
      addEntry({
        path: `${dir}/**`,
        class: "build-output",
        reason: "derived: build-output dir on disk",
      });
    }
  }

  // (c) Codegen headers
  if (tracked !== null) {
    for (const file of tracked) {
      const head = seams.readFileHead(file);
      if (head === null) continue;
      for (const lit of CODEGEN_HEADER_LITERALS) {
        if (head.includes(lit)) {
          addEntry({
            path: file,
            class: "codegen-header",
            reason: `derived: codegen header "${lit}"`,
          });
          break;
        }
      }
    }
  } else {
    degradedSignals.push("codegen-header");
  }

  // (d) .gitattributes
  if (tracked !== null) {
    const rawAttr = seams.readGitattributes();
    if (rawAttr !== null) {
      const tr = translateGitattributes(rawAttr);
      for (const sk of tr.skipped) {
        skipped.push(sk);
      }
      for (const glob of tr.globs) {
        addEntry({
          path: glob,
          class: "linguist-generated",
          reason: "derived: .gitattributes linguist-generated",
        });
      }
    }
  } else {
    degradedSignals.push("linguist-generated");
  }

  // (e) Vendored dirs
  for (const dir of VENDORED_DIRS) {
    if (seams.dirExists(dir)) {
      addEntry({
        path: `${dir}/**`,
        class: "vendored",
        reason: "derived: vendored dir",
      });
    }
  }

  const sortedEntries = Array.from(entriesMap.values()).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  const file = parseFenceFile({
    version: 1,
    allow: [],
    entries: sortedEntries,
  });

  return {
    file,
    skipped,
    degradedSignals,
  };
}
