import {
  type CoreRegistry,
  type WarmStartBrief,
  assembleWarmStartBrief,
  readWarmStartState,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetWarmStartBriefEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    budgetTokens: z.number().int().min(300).max(8000).optional(),
  })
  .strict();

export type GetWarmStartBriefResult = { brief: WarmStartBrief };

// Polling agents get the same assembler as the SessionStart hook, minus git
// delta (an MCP server has no reliable cwd) and minus Pro reonboard (no
// entitlement dep in mcp-bridge) — the brief itself is the free tier anyway.
export async function handleGetWarmStartBrief(
  env: GetWarmStartBriefEnv,
  rawArgs: unknown,
): Promise<GetWarmStartBriefResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const projectId = parsed.data.projectId as ProjectId;
  const project = env.registry.getProject(projectId);
  if (project === null) {
    throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
  }
  const nowIso = env.now();
  const brief = assembleWarmStartBrief({
    projectName: project.name,
    branch: null,
    now: nowIso,
    ...(parsed.data.budgetTokens !== undefined ? { budgetTokens: parsed.data.budgetTokens } : {}),
    lastSeenAt: readWarmStartState(env.storeRoot, projectId)?.lastSeenAt ?? null,
    reonboardUnlocked: false,
    timeless: false,
    memories: env.registry.listMemoryEntries(projectId),
    rules: env.registry.listProjectRules(projectId),
    failedAttempts: env.registry.listFailedAttempts(projectId),
    gitDelta: null,
  });
  return { brief };
}
