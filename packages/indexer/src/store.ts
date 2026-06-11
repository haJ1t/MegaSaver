import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { type CodeBlock, codeBlockSchema } from "./code-block.js";

export type ManifestEntry = { fileHash: string; blockIds: string[] };
export type Manifest = { files: Record<string, ManifestEntry> };
export type IndexStorePaths = { indexDir: string; blocksPath: string; manifestPath: string };

const manifestSchema = z.object({
  files: z.record(
    z.object({
      fileHash: z.string(),
      blockIds: z.array(z.string()),
    }),
  ),
});

export function resolveIndexPaths(storeDir: string, projectId: ProjectId): IndexStorePaths {
  const indexDir = join(storeDir, "projects", projectId, "index");
  return {
    indexDir,
    blocksPath: join(indexDir, "blocks.jsonl"),
    manifestPath: join(indexDir, "manifest.json"),
  };
}

function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  const fd = openSync(tempPath, "w");
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
}

export function readBlocks(paths: IndexStorePaths): CodeBlock[] {
  let raw: string;
  try {
    raw = readFileSync(paths.blocksPath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => codeBlockSchema.parse(JSON.parse(line)));
}

export function readManifest(paths: IndexStorePaths): Manifest {
  try {
    return manifestSchema.parse(JSON.parse(readFileSync(paths.manifestPath, "utf8")));
  } catch {
    return { files: {} };
  }
}

export function writeIndex(
  paths: IndexStorePaths,
  blocks: readonly CodeBlock[],
  manifest: Manifest,
): void {
  const body = blocks.map((block) => JSON.stringify(block)).join("\n");
  atomicWrite(paths.blocksPath, body.length === 0 ? "" : `${body}\n`);
  atomicWrite(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
