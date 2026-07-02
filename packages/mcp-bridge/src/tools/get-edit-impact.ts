import { execFileSync } from "node:child_process";
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

export type EditImpactResult = {
  changedFiles: string[];
  seeds: string[];
  pack: ContextPack;
  suggestedTests: string[];
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    changedFiles: z.array(z.string()).optional(),
  })
  .strict();

// Bound the seed fan-out: an edit touching a large file should not explode into
// one reverse-BFS per defined symbol. First 8 in file/block order — deterministic
// because changedFiles order and manifest blockIds order are both stable.
const MAX_SEEDS = 8;

// Mirrors readCoChangeLog's git edge: shell out once, graceful empty on any
// failure (not a git repo, git missing, no HEAD). Paths are repo-relative —
// the same shape the index manifest keys use.
function gitChangedFiles(cwd: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

// Changed file → its indexed blocks' names (manifest lookup, no hunk parsing —
// locked decision: hunk-level symbol resolution overmatches).
function deriveSeeds(
  changedFiles: readonly string[],
  manifest: Manifest,
  blocks: readonly CodeBlock[],
): string[] {
  const blockById = new Map<string, CodeBlock>(blocks.map((block) => [block.id, block]));
  const seeds: string[] = [];
  const seen = new Set<string>();
  for (const file of changedFiles) {
    const entry = manifest.files[file];
    if (entry === undefined) continue;
    for (const blockId of entry.blockIds) {
      const name = blockById.get(blockId)?.name;
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      seeds.push(name);
      if (seeds.length >= MAX_SEEDS) return seeds;
    }
  }
  return seeds;
}

// Union of per-seed impact packs, deduped by block id. A block excluded for one
// seed but included for another counts as included. usedTokens is recomputed
// over the merged set so overlapping seeds are not double-counted.
function mergePacks(
  seeds: readonly string[],
  packs: readonly ContextPack[],
  blocksConsidered: number,
): ContextPack {
  const included: ScoredBlock[] = [];
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
  const usedTokens = included.reduce(
    (sum, block) => sum + estimateSpanTokens(block.startLine, block.endLine),
    0,
  );
  return {
    task: seeds.length === 0 ? "edit-impact" : `edit-impact: ${seeds.join(", ")}`,
    included,
    excluded,
    budget: { maxTokens: null, usedTokens, blocksConsidered },
  };
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

  const changedFiles = parsed.data.changedFiles ?? gitChangedFiles(project.rootPath);
  if (changedFiles.length === 0) {
    return { changedFiles: [], seeds: [], pack: mergePacks([], [], 0), suggestedTests: [] };
  }

  const paths = resolveIndexPaths(env.storeRoot, projectId.data);
  const manifest = readManifest(paths);
  const blocks = readBlocks(paths);
  const seeds = deriveSeeds(changedFiles, manifest, blocks);
  const packs = seeds.map((seed) => buildImpactPack({ symbol: seed, blocks }));
  const pack = mergePacks(seeds, packs, blocks.length);

  const suggestedTests: string[] = [];
  const seenTestFiles = new Set<string>();
  for (const block of pack.included) {
    if (block.blockType !== "test" || seenTestFiles.has(block.filePath)) continue;
    seenTestFiles.add(block.filePath);
    suggestedTests.push(block.filePath);
  }

  return { changedFiles, seeds, pack, suggestedTests };
}
