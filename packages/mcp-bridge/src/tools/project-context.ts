import type {
  CoreRegistry,
  FailedAttempt,
  MemoryEntry,
  Project,
  ProjectRule,
  RuleSeverity,
} from "@megasaver/core";
import { readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetProjectContextEnv = { registry: CoreRegistry; storeRoot: string };

const inputSchema = z.object({ projectId: z.string().min(1) }).strict();

export type IndexSummary = {
  totalBlocks: number;
  fileCount: number;
  byType: Record<string, number>;
};

export type ProjectContext = {
  project: Project;
  rules: readonly ProjectRule[];
  keyMemories: readonly MemoryEntry[];
  indexSummary: IndexSummary;
  openFailures: readonly FailedAttempt[];
};

// critical first — most urgent rules surface at the top of an agent briefing.
const SEVERITY_RANK: Record<RuleSeverity, number> = { critical: 0, warning: 1, info: 2 };

// "key memories" = non-stale, medium/high-confidence design knowledge an agent
// should hold for any task in this project.
const KEY_MEMORY_TYPES = new Set(["decision", "architecture", "project_rule"]);

export async function handleGetProjectContext(
  env: GetProjectContextEnv,
  rawArgs: unknown,
): Promise<ProjectContext> {
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

  const rules = [...env.registry.listProjectRules(projectId.data)].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  const keyMemories = env.registry
    .listMemoryEntries(projectId.data)
    .filter((m) => !m.stale && m.confidence !== "low" && KEY_MEMORY_TYPES.has(m.type));

  const openFailures = env.registry
    .listFailedAttempts(projectId.data)
    .filter((fa) => !fa.convertedToRule);

  // readBlocks returns [] when no index exists on disk — graceful degradation.
  const blocks = readBlocks(resolveIndexPaths(env.storeRoot, projectId.data));
  const byType: Record<string, number> = {};
  const files = new Set<string>();
  for (const block of blocks) {
    byType[block.blockType] = (byType[block.blockType] ?? 0) + 1;
    files.add(block.filePath);
  }
  const indexSummary: IndexSummary = {
    totalBlocks: blocks.length,
    fileCount: files.size,
    byType,
  };

  return { project, rules, keyMemories, indexSummary, openFailures };
}
