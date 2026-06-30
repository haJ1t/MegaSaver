import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectId, WorkspaceKey } from "@megasaver/shared";
import { type CodeBlock, type ExtractedBlock, codeBlockSchema } from "./code-block.js";
import { embedBlocks } from "./embed-blocks.js";
import { extractJson } from "./extract/extract-json.js";
import { extractMd } from "./extract/extract-md.js";
import { extractTs } from "./extract/extract-ts.js";
import { blockFqn, resolveCallFqn } from "./resolve-fqn.js";
import { scanRepo } from "./scan.js";
import {
  type IndexStorePaths,
  type Manifest,
  readBlocks,
  readManifest,
  resolveIndexPaths,
  writeIndex,
} from "./store.js";
import { resolveWorkspaceIndexPaths, workspaceProjectId } from "./workspace-store.js";

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
  // Opt-in (default false). When true, embed each block and write an
  // embeddings.jsonl sidecar next to blocks.jsonl. Default builds touch no
  // embeddings code path and load no model.
  embeddings?: boolean;
};

const TS_LIKE_RE = /\.[cm]?[jt]sx?$/;

type Extractor = (filePath: string, source: string) => ExtractedBlock[];

function extractorFor(path: string): Extractor | null {
  if (TS_LIKE_RE.test(path)) return extractTs;
  if (path.endsWith(".md")) return extractMd;
  if (path.endsWith(".json")) return extractJson;
  return null;
}

export type WorkspaceBuildOptions = {
  rootDir: string;
  storeDir: string;
  workspaceKey: WorkspaceKey;
  newId?: () => string;
  maxFileSize?: number;
  embeddings?: boolean;
};

// Incremental: a file whose content hash matches the manifest keeps its existing
// blocks untouched; only changed/new files are re-extracted, and files that
// vanished drop their blocks. Persisted atomically (blocks.jsonl + manifest).
export function buildIndex(options: BuildOptions): Promise<BuildResult> {
  return buildIndexCore({
    rootDir: options.rootDir,
    paths: resolveIndexPaths(options.storeDir, options.projectId),
    projectId: options.projectId,
    ...(options.newId !== undefined ? { newId: options.newId } : {}),
    ...(options.maxFileSize !== undefined ? { maxFileSize: options.maxFileSize } : {}),
    ...(options.embeddings !== undefined ? { embeddings: options.embeddings } : {}),
  });
}

// Workspace-keyed build (CLI/seed only; not wired to a route in Phase 3). Writes
// to index/<key>/ and stamps each block with a synthetic UUIDv5 projectId so the
// existing codeBlockSchema parse passes without a schema migration (spec §6 R1).
export function buildWorkspaceIndex(options: WorkspaceBuildOptions): Promise<BuildResult> {
  return buildIndexCore({
    rootDir: options.rootDir,
    paths: resolveWorkspaceIndexPaths(options.storeDir, options.workspaceKey),
    projectId: workspaceProjectId(options.workspaceKey),
    ...(options.newId !== undefined ? { newId: options.newId } : {}),
    ...(options.maxFileSize !== undefined ? { maxFileSize: options.maxFileSize } : {}),
    ...(options.embeddings !== undefined ? { embeddings: options.embeddings } : {}),
  });
}

type BuildCoreOptions = {
  rootDir: string;
  paths: IndexStorePaths;
  projectId: ProjectId;
  newId?: () => string;
  maxFileSize?: number;
  embeddings?: boolean;
};

async function buildIndexCore(options: BuildCoreOptions): Promise<BuildResult> {
  const newId = options.newId ?? (() => randomUUID());
  const paths = options.paths;
  const scan = scanRepo({
    rootDir: options.rootDir,
    ...(options.maxFileSize !== undefined ? { maxFileSize: options.maxFileSize } : {}),
  });

  const prevManifest = readManifest(paths);
  let prevById: Map<CodeBlock["id"], CodeBlock>;
  try {
    prevById = new Map(readBlocks(paths).map((block) => [block.id, block]));
  } catch {
    // A corrupt/torn blocks.jsonl is recoverable: treat the prior index as
    // empty so every file re-extracts from source (self-heal, not hard fail).
    prevById = new Map();
  }

  const nextManifest: Manifest = { files: {} };
  const nextBlocks: CodeBlock[] = [];
  const scannedPaths = new Set<string>();
  // Per-file import bindings (local name → specifier) for freshly-extracted
  // TS/JS files, used to resolve calls to FQNs (WS2). Reused (unchanged) blocks
  // already carry their resolvedCalls from a prior build, so missing bindings
  // here are fine.
  const bindingsByFile = new Map<string, Record<string, string>>();
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
      const kept = prev.blockIds.map((id) => prevById.get(id as CodeBlock["id"]));
      // Reuse only when every referenced block is actually present. A missing
      // block means the manifest drifted from blocks.jsonl (torn write /
      // corruption) — fall through and re-extract this file instead of
      // persisting a manifest that points at blocks we no longer have.
      if (kept.every((block): block is CodeBlock => block !== undefined)) {
        nextBlocks.push(...kept);
        nextManifest.files[file.path] = { fileHash, blockIds: prev.blockIds };
        unchanged += 1;
        continue;
      }
    }

    const ids: string[] = [];
    for (const extracted of extractor(file.path, content)) {
      const { importBindings, ...persisted } = extracted;
      if (importBindings !== undefined) bindingsByFile.set(file.path, importBindings);
      const block = codeBlockSchema.parse({
        ...persisted,
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

  // Second pass (spec §11.2): derive calledBy within the indexed set —
  // calledBy[X] = the names of blocks whose `calls` include X's name. Recomputed
  // from scratch each build (kept blocks included) so it never goes stale; this
  // does not affect contentHash (hash is over source text, not calledBy).
  const callersByCallee = new Map<string, Set<string>>();
  for (const block of nextBlocks) {
    if (block.name === undefined) continue;
    for (const callee of block.calls) {
      const callers = callersByCallee.get(callee) ?? new Set<string>();
      callers.add(block.name);
      callersByCallee.set(callee, callers);
    }
  }

  // WS2: resolve each freshly-extracted TS/JS block's `calls` to FQNs via the
  // file's import bindings; reused blocks keep the resolvedCalls they were
  // persisted with (source-derived, stable for unchanged content). Then invert
  // to resolvedCalledBy. A relative specifier resolves against scannedPaths.
  // ponytail: a reused caller can carry stale resolvedCalls if an imported
  // target file was renamed without the caller changing; the name-based
  // calledBy fallback still covers that block, and a full ts.Program reresolve
  // is the deferred full-LSP phase.
  const fileExists = (path: string): boolean => scannedPaths.has(path);
  // Defined FQNs in this index — used to upgrade a local (non-imported) call
  // `#name` to the same-file definition `<file>#name` so the forward dependency
  // closure still resolves intra-file edges precisely.
  const definedFqns = new Set<string>();
  for (const block of nextBlocks) {
    if (block.name !== undefined) definedFqns.add(blockFqn(block.filePath, block.name));
  }
  const resolvedCallsByBlockId = new Map<string, string[]>();
  for (const block of nextBlocks) {
    const bindings = bindingsByFile.get(block.filePath);
    if (bindings === undefined) continue;
    resolvedCallsByBlockId.set(
      block.id,
      block.calls.map((callee) => {
        const fqn = resolveCallFqn(block.filePath, callee, bindings, fileExists);
        if (fqn.startsWith("#")) {
          const localFqn = blockFqn(block.filePath, callee);
          if (definedFqns.has(localFqn)) return localFqn;
        }
        return fqn;
      }),
    );
  }

  const resolvedCallersByFqn = new Map<string, Set<string>>();
  for (const block of nextBlocks) {
    if (block.name === undefined) continue;
    const callerFqn = blockFqn(block.filePath, block.name);
    const resolvedCalls = resolvedCallsByBlockId.get(block.id) ?? block.resolvedCalls;
    if (resolvedCalls === undefined) continue;
    for (const calleeFqn of resolvedCalls) {
      const callers = resolvedCallersByFqn.get(calleeFqn) ?? new Set<string>();
      callers.add(callerFqn);
      resolvedCallersByFqn.set(calleeFqn, callers);
    }
  }

  const finalBlocks = nextBlocks.map((block) => {
    const calledBy =
      block.name !== undefined ? [...(callersByCallee.get(block.name) ?? [])].sort() : [];
    const resolvedCalls = resolvedCallsByBlockId.get(block.id) ?? block.resolvedCalls;
    // resolvedCalledBy unions precise callers (keyed by this block's FQN) with
    // callers whose edge stayed unresolved as "#<name>" (namespace-member /
    // unpinnable calls). The unresolved bucket keeps resolved-mode reach >=
    // name-mode: a caller the name path had is never dropped, while precise
    // edges still disambiguate same-named functions across files.
    let resolvedCalledBy: Set<string> | undefined;
    if (block.name !== undefined) {
      const precise = resolvedCallersByFqn.get(blockFqn(block.filePath, block.name));
      const unresolved = resolvedCallersByFqn.get(`#${block.name}`);
      if (precise !== undefined || unresolved !== undefined) {
        resolvedCalledBy = new Set([...(precise ?? []), ...(unresolved ?? [])]);
      }
    }
    return {
      ...block,
      calledBy,
      ...(resolvedCalls !== undefined ? { resolvedCalls } : {}),
      ...(resolvedCalledBy !== undefined ? { resolvedCalledBy: [...resolvedCalledBy].sort() } : {}),
    };
  });

  writeIndex(paths, finalBlocks, nextManifest);

  if (options.embeddings === true) {
    const priorHashById = new Map<string, string>();
    for (const [id, block] of prevById) priorHashById.set(id, block.contentHash);
    await embedBlocks(paths, finalBlocks, priorHashById);
  }

  return { added, updated, removed, unchanged, blockCount: nextBlocks.length };
}
