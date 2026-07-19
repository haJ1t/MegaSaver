import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { Lm1Error } from "./lm1-errors.js";
import type { Lm1Kind } from "./lm1-model.js";

function assertNotSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Lm1Error("store_corrupt", "Long-memory path is a symbolic link.");
  }
}

function ensureDirectory(path: string): void {
  assertNotSymlink(path);
  mkdirSync(path, { recursive: true });
  if (!lstatSync(path).isDirectory()) {
    throw new Lm1Error("store_corrupt", "Long-memory path is not a directory.");
  }
  assertNotSymlink(path);
}

export function lm1RecordDirectory(storeRoot: string, workspaceKey: string, kind: Lm1Kind): string {
  const parsedWorkspaceKey = workspaceKeySchema.safeParse(workspaceKey);
  if (!parsedWorkspaceKey.success) {
    throw new Lm1Error("invalid_input", "Invalid workspace key.");
  }
  const root = join(storeRoot, "long-memory");
  const version = join(root, "v1");
  const workspace = join(version, parsedWorkspaceKey.data);
  const records = join(workspace, kind === "state_snapshot" ? "snapshots" : "transitions");
  ensureDirectory(storeRoot);
  ensureDirectory(root);
  ensureDirectory(version);
  ensureDirectory(workspace);
  ensureDirectory(records);
  return records;
}

export function lm1RecordPath(
  storeRoot: string,
  workspaceKey: string,
  kind: Lm1Kind,
  sourceDigest: string,
): string {
  const directory = lm1RecordDirectory(storeRoot, workspaceKey, kind);
  const path = join(directory, `${sourceDigest}.json`);
  assertNotSymlink(path);
  return path;
}

export function assertLm1PathIsNotSymlink(path: string): void {
  assertNotSymlink(path);
}
