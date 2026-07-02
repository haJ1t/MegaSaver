import { execFileSync } from "node:child_process";
import { isAbsolute, relative } from "node:path";
import {
  type ContextPack,
  type ScoredBlock,
  buildImpactPack,
  estimateSpanTokens,
} from "@megasaver/context-pruner";
import type { CoreRegistry } from "@megasaver/core";
import {
  type CodeBlock,
  type Manifest,
  readBlocks,
  readManifest,
  resolveIndexPaths,
} from "@megasaver/indexer";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type EditImpactToolEnv = { registry: CoreRegistry; storeRoot: string };

export type EmptyImpactReason = "no-changes" | "git-unavailable";

export type EditImpactResult = {
  changedFiles: string[];
  unmatchedFiles: string[];
  seeds: string[];
  pack: ContextPack;
  suggestedTests: string[];
  reason?: EmptyImpactReason;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    changedFiles: z.array(z.string()).optional(),
    maxTokens: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

// Bound the seed fan-out: an edit touching a large file should not explode into
// one reverse-BFS per defined symbol. First 8 in file/block order — deterministic
// because changedFiles order and manifest blockIds order are both stable.
const MAX_SEEDS = 8;
const MAX_SUGGESTED_TESTS = 10;
// A hung git hook or a pathological diff must not block the MCP handler.
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

// Matches pack.ts's exclusionReason("budget") so merged-cap drops read the same.
const BUDGET_REASON = "excluded: cut by token/limit budget";

// Mirrors readCoChangeLog's git edge: shell out once; null on any failure (not
// a git repo, git missing, no HEAD) so the caller can report 'git-unavailable'
// instead of conflating it with a clean tree. quotePath=off keeps non-ASCII
// paths verbatim — otherwise git octal-escapes and quotes them and they never
// match manifest keys. Paths are repo-relative, the shape manifest keys use.
function gitChangedFiles(cwd: string): string[] | null {
  try {
    const out = execFileSync("git", ["-c", "core.quotePath=off", "diff", "--name-only", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return null;
  }
}

// Manifest keys are repo-relative POSIX paths (scanRepo normalizes). Meet
// explicit changedFiles halfway — absolute → relative to the project root,
// backslashes → "/", leading "./" stripped — otherwise a valid edit silently
// derives no seeds.
function normalizeChangedFile(file: string, rootPath: string): string {
  let normalized = file.replace(/\\/g, "/");
  if (isAbsolute(normalized)) {
    normalized = relative(rootPath, normalized).replace(/\\/g, "/");
  }
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

// Changed file → its indexed blocks' names (manifest lookup, no hunk parsing —
// locked decision: hunk-level symbol resolution overmatches). Object.hasOwn
// guards the JSON-derived record: a bare lookup of "__proto__"/"constructor"/
// "toString" would hit the prototype chain and crash on entry.blockIds.
function deriveSeeds(
  changedFiles: readonly string[],
  manifest: Manifest,
  blocks: readonly CodeBlock[],
): { seeds: string[]; matchedFiles: string[]; unmatchedFiles: string[] } {
  const blockById = new Map<string, CodeBlock>(blocks.map((block) => [block.id, block]));
  const seeds: string[] = [];
  const seen = new Set<string>();
  const matchedFiles: string[] = [];
  const unmatchedFiles: string[] = [];
  for (const file of changedFiles) {
    const entry = Object.hasOwn(manifest.files, file) ? manifest.files[file] : undefined;
    if (entry === undefined) {
      unmatchedFiles.push(file);
      continue;
    }
    matchedFiles.push(file);
    for (const blockId of entry.blockIds) {
      if (seeds.length >= MAX_SEEDS) break;
      const name = blockById.get(blockId)?.name;
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      seeds.push(name);
    }
  }
  return { seeds, matchedFiles, unmatchedFiles };
}

// Union of per-seed impact packs, deduped by block id. A block excluded for one
// seed but included for another counts as included. usedTokens is recomputed
// over the merged set so overlapping seeds are not double-counted; maxTokens is
// then re-enforced as a SHARED cap — per-seed packs each fit the budget, but
// their union may not. Lowest-score included blocks drop first (blockId
// tie-break, deterministic) and land in excluded with the budget reason.
function mergePacks(
  seeds: readonly string[],
  packs: readonly ContextPack[],
  blocksConsidered: number,
  maxTokens: number | undefined,
): ContextPack {
  let included: ScoredBlock[] = [];
  const includedIds = new Set<string>();
  for (const pack of packs) {
    for (const block of pack.included) {
      if (includedIds.has(block.blockId)) continue;
      includedIds.add(block.blockId);
      included.push(block);
    }
  }
  const excluded: ScoredBlock[] = [];
  const excludedIds = new Set<string>();
  for (const pack of packs) {
    for (const block of pack.excluded) {
      if (includedIds.has(block.blockId) || excludedIds.has(block.blockId)) continue;
      excludedIds.add(block.blockId);
      excluded.push(block);
    }
  }
  let usedTokens = included.reduce(
    (sum, block) => sum + estimateSpanTokens(block.startLine, block.endLine),
    0,
  );
  if (maxTokens !== undefined && usedTokens > maxTokens) {
    const dropOrder = [...included].sort(
      (a, b) => a.score - b.score || a.blockId.localeCompare(b.blockId),
    );
    const dropped = new Set<string>();
    for (const block of dropOrder) {
      if (usedTokens <= maxTokens) break;
      dropped.add(block.blockId);
      usedTokens -= estimateSpanTokens(block.startLine, block.endLine);
      excluded.push({ ...block, reasons: [BUDGET_REASON] });
    }
    included = included.filter((block) => !dropped.has(block.blockId));
  }
  return {
    task: seeds.length === 0 ? "edit-impact" : `edit-impact: ${seeds.join(", ")}`,
    included,
    excluded,
    budget: { maxTokens: maxTokens ?? null, usedTokens, blocksConsidered },
  };
}

const TEST_BASENAME_RE = /\.(test|spec)\./;
const TESTS_DIR_RE = /(^|\/)__tests__\//;

function isTestFilePath(filePath: string): boolean {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  return TEST_BASENAME_RE.test(base) || TESTS_DIR_RE.test(filePath);
}

function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

// "src/a.test.ts" → "a": basename minus the final extension minus a trailing
// .test/.spec marker, so a test file and its subject share a stem.
function fileStem(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  return base.replace(/\.[^.]+$/, "").replace(/\.(test|spec)$/, "");
}

// Test discovery must survive two structural gaps: (a) real Vitest/Jest files
// are bare top-level describe() calls — the TS extractor emits no named blocks
// for them, so they can never appear as callers; (b) indexed test blocks get
// budget-cut out of pack.included. Union three sources: test-typed blocks in
// the merged pack (included + excluded), test-typed DIRECT callers of included
// blocks (edge walk, budget-immune), and a filename heuristic over manifest
// keys — a test-convention file (*.test.*, *.spec.*, __tests__/) whose stem
// matches an impacted file's stem or that lives beside one. Deterministic:
// pack traversal order first, then sorted heuristic hits; deduped and capped.
function collectSuggestedTests(
  pack: ContextPack,
  blocks: readonly CodeBlock[],
  impactedFiles: readonly string[],
  manifest: Manifest,
): string[] {
  const suggestions: string[] = [];
  const seen = new Set<string>();
  const suggest = (filePath: string): void => {
    if (seen.has(filePath) || suggestions.length >= MAX_SUGGESTED_TESTS) return;
    seen.add(filePath);
    suggestions.push(filePath);
  };

  for (const block of [...pack.included, ...pack.excluded]) {
    if (block.blockType === "test") suggest(block.filePath);
  }

  const blockById = new Map<string, CodeBlock>(blocks.map((block) => [block.id, block]));
  const byName = new Map<string, CodeBlock>();
  const byFqn = new Map<string, CodeBlock>();
  for (const block of blocks) {
    if (block.name === undefined) continue;
    if (!byName.has(block.name)) byName.set(block.name, block);
    const fqn = `${block.filePath}#${block.name}`;
    if (!byFqn.has(fqn)) byFqn.set(fqn, block);
  }
  for (const includedBlock of pack.included) {
    const block = blockById.get(includedBlock.blockId);
    if (block === undefined) continue;
    const callers =
      block.resolvedCalledBy !== undefined
        ? block.resolvedCalledBy.map(
            (fqn) => byFqn.get(fqn) ?? byName.get(fqn.slice(fqn.indexOf("#") + 1)),
          )
        : block.calledBy.map((name) => byName.get(name));
    for (const caller of callers) {
      if (caller !== undefined && caller.blockType === "test") suggest(caller.filePath);
    }
  }

  const stems = new Set(impactedFiles.map(fileStem));
  const dirs = new Set(impactedFiles.map(dirOf));
  const testFiles = Object.keys(manifest.files).filter(isTestFilePath).sort();
  for (const testFile of testFiles) {
    if (stems.has(fileStem(testFile)) || dirs.has(dirOf(testFile))) suggest(testFile);
  }

  return suggestions;
}

// The edit-time counterpart of get_task_context: discover the symbols an edit
// touched (explicit changedFiles or git diff), union their reverse call-graph
// blast radii, and surface which test files sit inside the radius.
export function handleGetEditImpact(env: EditImpactToolEnv, rawArgs: unknown): EditImpactResult {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = projectIdSchema.safeParse(parsed.data.projectId);
  if (!projectId.success) {
    throw new McpBridgeError("validation_failed", `invalid projectId: ${parsed.data.projectId}`);
  }
  const project = env.registry.getProject(projectId.data);
  if (project === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${parsed.data.projectId}`);
  }

  const explicit = parsed.data.changedFiles;
  const derived = explicit === undefined ? gitChangedFiles(project.rootPath) : undefined;
  const changedFiles = [
    ...new Set(
      (explicit ?? derived ?? []).map((file) => normalizeChangedFile(file, project.rootPath)),
    ),
  ];
  if (changedFiles.length === 0) {
    return {
      changedFiles: [],
      unmatchedFiles: [],
      seeds: [],
      pack: mergePacks([], [], 0, undefined),
      suggestedTests: [],
      reason: derived === null ? "git-unavailable" : "no-changes",
    };
  }

  const paths = resolveIndexPaths(env.storeRoot, projectId.data);
  const manifest = readManifest(paths);
  const blocks = readBlocks(paths);
  const { seeds, matchedFiles, unmatchedFiles } = deriveSeeds(changedFiles, manifest, blocks);
  const packs = seeds.map((seed) =>
    buildImpactPack({
      symbol: seed,
      blocks,
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.maxTokens !== undefined ? { maxTokens: parsed.data.maxTokens } : {}),
    }),
  );
  const pack = mergePacks(seeds, packs, blocks.length, parsed.data.maxTokens);
  const impactedFiles = [
    ...new Set([...matchedFiles, ...pack.included.map((block) => block.filePath)]),
  ];
  const suggestedTests = collectSuggestedTests(pack, blocks, impactedFiles, manifest);

  return { changedFiles, unmatchedFiles, seeds, pack, suggestedTests };
}
