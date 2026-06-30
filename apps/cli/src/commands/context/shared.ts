import { type ContextPack, buildContextPack, readCoChangeLog } from "@megasaver/context-pruner";
import { approvedMemoryFiles, staleMemoryFiles, taskScopedMemoryFiles } from "@megasaver/core";
import { readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import type { ProjectId } from "@megasaver/shared";
import { mapErrorToCliMessage } from "../../errors.js";
import { type StoreEnv, loadProjectContext } from "../index/shared.js";

export type ContextRequest = StoreEnv & {
  projectName: string;
  task: string;
  changedFiles: string[];
  failingTests: string[];
  limitFlag: number | undefined;
  maxTokensFlag: number | undefined;
  stderr: (line: string) => void;
};

export type LoadedPack = {
  pack: ContextPack;
  rootPath: string;
  projectId: ProjectId;
  rootDir: string;
};

export function taskRequiredMessage(): string {
  return "error: --task is required";
}

// Build a context pack from the project's existing index + relevant memories.
// Returns null after printing the matching error (caller returns exit 1).
export async function loadPack(input: ContextRequest): Promise<LoadedPack | null> {
  if (input.task.trim().length === 0) {
    input.stderr(taskRequiredMessage());
    return null;
  }
  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return null;
  try {
    const blocks = readBlocks(resolveIndexPaths(ctx.rootDir, ctx.project.id));
    const memories = ctx.registry.listMemoryEntries(ctx.project.id);
    // Task-scope the memoryRelevance feed when a memory sidecar exists: the CLI
    // has no pre-computed task vector, so the orchestrator embeds the task itself
    // best-effort. Null on no-sidecar / any failure → fall back to ALL approved
    // memory's relatedFiles (today's recall-safe behavior; never regresses).
    const scopedFiles = await taskScopedMemoryFiles({
      storeRoot: ctx.rootDir,
      projectId: ctx.project.id,
      memories,
      task: input.task,
    });
    const memoryFiles = scopedFiles ?? approvedMemoryFiles(memories);
    const staleFiles = staleMemoryFiles(memories);
    const pack = buildContextPack({
      task: input.task,
      blocks,
      changedFiles: input.changedFiles,
      failingTests: input.failingTests,
      memoryFiles,
      staleFiles,
      coChangeLog: readCoChangeLog(ctx.project.rootPath),
      ...(input.limitFlag !== undefined ? { limit: input.limitFlag } : {}),
      ...(input.maxTokensFlag !== undefined ? { maxTokens: input.maxTokensFlag } : {}),
    });
    return {
      pack,
      rootPath: ctx.project.rootPath,
      projectId: ctx.project.id,
      rootDir: ctx.rootDir,
    };
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return null;
  }
}

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}
