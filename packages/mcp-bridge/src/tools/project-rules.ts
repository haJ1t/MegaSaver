import {
  type CoreRegistry,
  CoreRegistryError,
  type ProjectRule,
  projectRuleSchema,
  ruleConfidenceSchema,
  ruleCreatedFromSchema,
  ruleSeveritySchema,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type SaveProjectRuleEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};
export type GetProjectRulesEnv = { registry: CoreRegistry };

const saveInputSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    rule: z.string().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    createdFrom: ruleCreatedFromSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
  })
  .strict();

const getInputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1).optional(),
    files: z.array(z.string()).optional(),
  })
  .strict();

export type GetProjectRulesResult = { rules: readonly ProjectRule[] };

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "project_not_found")
      return new McpBridgeError("resource_not_found", err.message);
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "save_project_rule failed");
}

export async function handleSaveProjectRule(
  env: SaveProjectRuleEnv,
  rawArgs: unknown,
): Promise<{ id: string }> {
  const parsed = saveInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;

  let rule: ProjectRule;
  try {
    rule = projectRuleSchema.parse({
      id: env.newId(),
      projectId: d.projectId,
      title: d.title,
      rule: d.rule,
      appliesTo: d.appliesTo ?? [],
      evidence: d.evidence ?? [],
      severity: d.severity,
      confidence: d.confidence ?? "medium",
      createdFrom: d.createdFrom ?? "manual",
      createdAt: env.now(),
      updatedAt: env.now(),
    });
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "invalid project rule",
    );
  }

  try {
    const created = env.registry.createProjectRule(rule);
    return { id: created.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}

// Simple, deterministic filter (spec §11): a rule matches when any `appliesTo`
// entry is a prefix of a requested file (or vice-versa), or when a task term
// appears in its title/rule text. No filter → all rules. A scored rank lands
// with Phase 5 `rules apply --task`.
function ruleMatches(
  rule: ProjectRule,
  task: string | undefined,
  files: readonly string[],
): boolean {
  if (task === undefined && files.length === 0) return true;
  for (const file of files) {
    for (const glob of rule.appliesTo) {
      if (file.startsWith(glob) || glob.startsWith(file)) return true;
    }
  }
  if (task !== undefined) {
    const haystack = `${rule.title} ${rule.rule}`.toLowerCase();
    if (
      task
        .toLowerCase()
        .split(/\s+/)
        .some((term) => term.length > 2 && haystack.includes(term))
    ) {
      return true;
    }
  }
  return false;
}

export async function handleGetProjectRules(
  env: GetProjectRulesEnv,
  rawArgs: unknown,
): Promise<GetProjectRulesResult> {
  const parsed = getInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, files } = parsed.data;

  try {
    const all = env.registry.listProjectRules(projectId as ProjectId);
    const rules = all.filter((rule) => ruleMatches(rule, task, files ?? []));
    return { rules };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
