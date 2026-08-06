// Strip build-only metadata from the PUBLISHED @megasaver/cli manifest.
//
// The published package ships only the self-contained `dist-bundle/mega.mjs`
// bundle, which inlines every dependency except the chain tsup.bundle.config.ts
// leaves `external`. The source package.json keeps its 8
// private `@megasaver/*` workspace packages (plus citty, zod) in devDependencies
// because turbo's `^build` ordering needs them — but those entries are useless
// (and SCA-tripping: they point at private:true packages never on the registry)
// in the published tarball. So at pack time we rewrite the manifest to drop
// devDependencies and the inlined `dependencies`, then restore the working-tree
// copy afterwards.
//
// Wired via apps/cli/package.json:
//   "prepack":  "pnpm run bundle && node scripts/strip-publish-manifest.mjs prepack"
//   "postpack": "node scripts/strip-publish-manifest.mjs postpack"
//
// npm/pnpm run prepack -> (tarball is created from the stripped manifest) ->
// postpack, so the packed package.json is the stripped one while the source
// file is restored byte-for-byte the moment packing finishes.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_FILE = "package.json";
export const BACKUP_FILE = "package.json.bak";

// Default target: the package root that owns this script (scripts/.. == apps/cli).
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PKG_DIR = dirname(SCRIPT_DIR);

// Runtime `dependencies` the standalone bundle does NOT inline, so npm must
// still install them for the published CLI to work. Mirrors the `external`
// array in tsup.bundle.config.ts: `fs-ext` is a native addon (nan/*.node) that
// cannot be inlined into an ESM single file, and @megasaver/stats reaches it
// through `require("fs-ext")` at runtime. Everything else the manifest declares
// under `dependencies` is inlined by that config's `noExternal` catch-all —
// notably `typescript`, which @megasaver/indexer statically imports and tsup
// therefore bakes into mega.mjs, making the ~20MB npm package pure dead weight
// in the tarball. The externalized optionalDependencies
// (@aws-sdk/client-s3, @huggingface/transformers) live in their own field and
// are left untouched.
export const EXTERNAL_RUNTIME_DEPENDENCIES = new Set(["fs-ext"]);

/**
 * Return a copy of `manifest` with build-only fields removed: devDependencies
 * (the only place the private @megasaver/* packages and citty/zod live) go
 * entirely, and `dependencies` is narrowed to the specifiers the bundle leaves
 * external. Pure: the input is not mutated.
 */
export function stripManifest(manifest) {
  const { devDependencies: _devDependencies, ...published } = manifest;

  if (published.dependencies) {
    published.dependencies = Object.fromEntries(
      Object.entries(published.dependencies).filter(([name]) =>
        EXTERNAL_RUNTIME_DEPENDENCIES.has(name),
      ),
    );
  }

  return published;
}

function manifestPath(dir) {
  return join(dir, MANIFEST_FILE);
}

function backupPath(dir) {
  return join(dir, BACKUP_FILE);
}

/**
 * prepack: back up the real manifest, then write the stripped publish manifest.
 * If a stale backup exists from an interrupted run, restore it first so the new
 * backup captures the true original rather than an already-stripped copy.
 */
export function runPrepack(dir = DEFAULT_PKG_DIR) {
  const manifest = manifestPath(dir);
  const backup = backupPath(dir);

  if (existsSync(backup)) {
    renameSync(backup, manifest);
  }

  const originalText = readFileSync(manifest, "utf8");
  writeFileSync(backup, originalText);

  const stripped = stripManifest(JSON.parse(originalText));
  writeFileSync(manifest, `${JSON.stringify(stripped, null, 2)}\n`);
}

/**
 * postpack: restore the working-tree manifest from the backup and remove it.
 * Restores unconditionally when a backup exists, so an interrupted pack that
 * left the stripped (or blanked) manifest behind is still recovered. No-op when
 * there is no backup (nothing was packed).
 */
export function runPostpack(dir = DEFAULT_PKG_DIR) {
  const backup = backupPath(dir);
  if (!existsSync(backup)) {
    return;
  }
  const manifest = manifestPath(dir);
  writeFileSync(manifest, readFileSync(backup, "utf8"));
  rmSync(backup, { force: true });
}

// CLI dispatch when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  if (mode === "prepack") {
    runPrepack();
  } else if (mode === "postpack") {
    runPostpack();
  } else {
    console.error(`strip-publish-manifest: expected "prepack" or "postpack", got "${mode ?? ""}"`);
    process.exit(1);
  }
}
