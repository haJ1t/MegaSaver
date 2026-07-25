import { fsyncSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { Lm1Error } from "./lm1-errors.js";
import { assertLm1PathIsNotSymlink, lm1WorkspaceDirectory } from "./lm1-paths.js";
import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import type { ModelDescriptor } from "./lm2-model.js";
import {
  type DirectoryAnchor,
  closeDirectoryAnchor,
  openDirectoryAnchor,
} from "./lm2-secure-fs.js";

function parsedWorkspaceKey(workspaceKey: string): string {
  const parsed = workspaceKeySchema.safeParse(workspaceKey);
  if (!parsed.success) throw new Lm2Error("invalid_input", "Invalid workspace key.");
  return parsed.data;
}

export function vectorWorkspacePath(storeRoot: string, workspaceKey: string): string {
  return join(resolve(storeRoot), "long-memory", "v1", parsedWorkspaceKey(workspaceKey));
}

export function embeddingsPath(storeRoot: string, workspaceKey: string): string {
  return join(vectorWorkspacePath(storeRoot, workspaceKey), "embeddings-v2");
}

export function legacyEmbeddingsPath(storeRoot: string, workspaceKey: string): string {
  return join(vectorWorkspacePath(storeRoot, workspaceKey), "embeddings");
}

export function vectorQuotaLedgerPath(storeRoot: string, workspaceKey: string): string {
  return join(vectorWorkspacePath(storeRoot, workspaceKey), ".lm2", "vector-quota-ledger-v1.json");
}

export function vectorOperationLockPath(storeRoot: string, workspaceKey: string): string {
  return join(vectorWorkspacePath(storeRoot, workspaceKey), ".lm2", "index-v1.lock");
}

export function vectorNamespacePath(
  storeRoot: string,
  workspaceKey: string,
  model: ModelDescriptor,
): string {
  return join(embeddingsPath(storeRoot, workspaceKey), modelDescriptorFingerprint(model));
}

export function vectorSidecarName(recordId: string): string {
  return `${recordId}.json`;
}

function ensureDirectory(path: string): DirectoryAnchor {
  try {
    assertLm1PathIsNotSymlink(path);
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw new Lm2Error("write_failed", "LM2 vector directory creation failed.");
    }
  }
  const anchor = openDirectoryAnchor(path, false);
  if (anchor === null) throw new Lm2Error("write_failed", "LM2 vector directory is missing.");
  try {
    if (process.platform !== "win32") {
      const parentDescriptor = anchor.chain.at(-2)?.descriptor;
      const directoryDescriptor = anchor.chain.at(-1)?.descriptor;
      if (parentDescriptor === undefined || directoryDescriptor === undefined) {
        throw new Lm2Error("write_failed", "LM2 vector directory anchor is invalid.");
      }
      fsyncSync(parentDescriptor);
      fsyncSync(directoryDescriptor);
    }
    return anchor;
  } catch {
    closeDirectoryAnchor(anchor);
    throw new Lm2Error("write_failed", "LM2 vector directory sync failed.");
  }
}

function ensureWorkspace(storeRoot: string, workspaceKey: string): string {
  try {
    return lm1WorkspaceDirectory(storeRoot, parsedWorkspaceKey(workspaceKey));
  } catch (error) {
    if (error instanceof Lm1Error && error.code === "invalid_input") {
      throw new Lm2Error("invalid_input", error.message);
    }
    throw new Lm2Error("write_failed", "LM2 workspace path is unavailable.");
  }
}

export function ensureIndexLockPath(storeRoot: string, workspaceKey: string): string {
  const workspace = ensureWorkspace(storeRoot, workspaceKey);
  const directory = join(workspace, ".lm2");
  const anchor = ensureDirectory(directory);
  closeDirectoryAnchor(anchor);
  return vectorOperationLockPath(storeRoot, workspaceKey);
}

export function ensureVectorNamespace(
  storeRoot: string,
  workspaceKey: string,
  model: ModelDescriptor,
): DirectoryAnchor {
  ensureWorkspace(storeRoot, workspaceKey);
  const embeddings = embeddingsPath(storeRoot, workspaceKey);
  const embeddingsAnchor = ensureDirectory(embeddings);
  closeDirectoryAnchor(embeddingsAnchor);
  return ensureDirectory(vectorNamespacePath(storeRoot, workspaceKey, model));
}
