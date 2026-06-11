import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { type CodeBlock, type ExtractedBlock, codeBlockSchema } from "./code-block.js";
import { extractJson } from "./extract/extract-json.js";
import { extractMd } from "./extract/extract-md.js";
import { extractTs } from "./extract/extract-ts.js";
import { scanRepo } from "./scan.js";
import { type Manifest, readBlocks, readManifest, resolveIndexPaths, writeIndex } from "./store.js";

export type BuildResult = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  blockCount: number;
};

export type BuildOptions = {
  rootDir: string;
  storeDir: string;
  projectId: ProjectId;
  newId?: () => string;
  maxFileSize?: number;
};

const TS_LIKE_RE = /\.[cm]?[jt]sx?$/;

type Extractor = (filePath: string, source: string) => ExtractedBlock[];

function extractorFor(path: string): Extractor | null {
  if (TS_LIKE_RE.test(path)) return extractTs;
  if (path.endsWith(".md")) return extractMd;
  if (path.endsWith(".json")) return extractJson;
  return null;
}

// Incremental: a file whose content hash matches the manifest keeps its existing
// blocks untouched; only changed/new files are re-extracted, and files that
// vanished drop their blocks. Persisted atomically (blocks.jsonl + manifest).
export function buildIndex(options: BuildOptions): BuildResult {
  const newId = options.newId ?? (() => randomUUID());
  const paths = resolveIndexPaths(options.storeDir, options.projectId);
  const scan = scanRepo({
    rootDir: options.rootDir,
    ...(options.maxFileSize !== undefined ? { maxFileSize: options.maxFileSize } : {}),
  });

  const prevManifest = readManifest(paths);
  const prevById = new Map(readBlocks(paths).map((block) => [block.id, block]));

  const nextManifest: Manifest = { files: {} };
  const nextBlocks: CodeBlock[] = [];
  const scannedPaths = new Set<string>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const file of scan.files) {
    const extractor = extractorFor(file.path);
    if (!extractor) continue;
    scannedPaths.add(file.path);

    const content = readFileSync(join(options.rootDir, file.path), "utf8");
    const fileHash = createHash("sha256").update(content).digest("hex");
    const prev = prevManifest.files[file.path];

    if (prev && prev.fileHash === fileHash) {
      for (const id of prev.blockIds) {
        const kept = prevById.get(id as CodeBlock["id"]);
        if (kept) nextBlocks.push(kept);
      }
      nextManifest.files[file.path] = { fileHash, blockIds: prev.blockIds };
      unchanged += 1;
      continue;
    }

    const ids: string[] = [];
    for (const extracted of extractor(file.path, content)) {
      const block = codeBlockSchema.parse({
        ...extracted,
        id: newId(),
        projectId: options.projectId,
        lastModifiedAt: file.mtimeIso,
      });
      nextBlocks.push(block);
      ids.push(block.id);
    }
    nextManifest.files[file.path] = { fileHash, blockIds: ids };
    if (prev) updated += 1;
    else added += 1;
  }

  let removed = 0;
  for (const path of Object.keys(prevManifest.files)) {
    if (!scannedPaths.has(path)) removed += 1;
  }

  writeIndex(paths, nextBlocks, nextManifest);
  return { added, updated, removed, unchanged, blockCount: nextBlocks.length };
}
