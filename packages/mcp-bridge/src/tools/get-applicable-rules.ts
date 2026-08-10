import {
  type CoreRegistry,
  CoreRegistryError,
  type RankedRule,
  rankApplicableRules,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type GetApplicableRulesEnv = {
  registry: CoreRegistry;
  now: () => string;
  storeRoot?: string;
  sessionId?: string;
};

export const inputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1).optional(),
    files: z.array(z.string()).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type GetApplicableRulesResult = {
  rules: readonly RankedRule[];
  airlockRules: readonly unknown[];
};

export async function handleGetApplicableRules(
  env: GetApplicableRulesEnv,
  rawArgs: unknown,
): Promise<GetApplicableRulesResult> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, files, limit } = parsed.data;
  try {
    const all = env.registry.listProjectRules(projectId as ProjectId);
    const rules = rankApplicableRules(all, {
      ...(task !== undefined ? { task } : {}),
      ...(files !== undefined ? { files } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    let airlockRules: readonly unknown[] = [];
    if (env.storeRoot !== undefined && env.sessionId !== undefined) {
      try {
        const { readRules } = await import("@megasaver/core");
        airlockRules = await readRules(env.storeRoot, env.sessionId);
      } catch {}
    }
    return { rules, airlockRules };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
