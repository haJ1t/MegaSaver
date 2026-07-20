import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { Lm1Error } from "./lm1-errors.js";
import { assertLm1PathIsNotSymlink, lm1WorkspaceDirectory } from "./lm1-paths.js";

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function ensureCatalogDirectory(storeRoot: string, workspaceKey: string): string {
  const workspace = lm1WorkspaceDirectory(storeRoot, workspaceKey);
  const directory = join(workspace, ".lm2");
  assertLm1PathIsNotSymlink(directory);
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    throw new Lm1Error("write_failed", "LM2 catalog directory creation failed.");
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(directory);
  } catch {
    throw new Lm1Error("store_corrupt", "LM2 catalog directory is unreadable.");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Lm1Error("store_corrupt", "LM2 catalog directory is invalid.");
  }
  try {
    fsyncDirectory(workspace);
    fsyncDirectory(directory);
  } catch {
    throw new Lm1Error("write_failed", "LM2 catalog directory sync failed.");
  }
  return directory;
}

export function lm2CandidateCatalogDirectory(storeRoot: string, workspaceKey: string): string {
  return ensureCatalogDirectory(storeRoot, workspaceKey);
}

export function lm2CandidateCatalogPath(storeRoot: string, workspaceKey: string): string {
  const path = join(
    lm2CandidateCatalogDirectory(storeRoot, workspaceKey),
    "candidate-catalog-v2.json",
  );
  assertLm1PathIsNotSymlink(path);
  return path;
}

export function lm2CandidateCatalogLockPath(storeRoot: string, workspaceKey: string): string {
  const path = join(
    lm2CandidateCatalogDirectory(storeRoot, workspaceKey),
    "candidate-catalog-v2.lock",
  );
  assertLm1PathIsNotSymlink(path);
  return path;
}
