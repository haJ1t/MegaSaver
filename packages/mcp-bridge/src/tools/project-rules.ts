import {
  type CoreRegistry,
  CoreRegistryError,
  type ProjectRule,
  WRITE_VERIFY_CONFIDENCE_CAP,
  defaultWriteExpiresAt,
  minConfidence,
  projectRuleSchema,
  ruleConfidenceSchema,
  ruleCreatedFromSchema,
  ruleSeveritySchema,
  verifyMemoryWrite,
} from "@megasaver/core";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { resolveWritePointers } from "../write-verify-resolver.js";

export type SaveProjectRuleEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  // Absent ⇒ resolver_unavailable ⇒ the rule can never verify (write still lands).
  storeRoot?: string;
};
export type GetProjectRulesEnv = { registry: CoreRegistry };

export const saveInputSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    rule: z.string().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    createdFrom: ruleCreatedFromSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).max(32).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const getInputSchema = z
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

  // Write gate (rules are ALWAYS gated, evidence only, no conflict corpus):
  // the gate NEVER drops the rule — unverified verdicts cap confidence and
  // stamp verification. `createdFrom` stays caller-claimed (pre-existing
  // semantics); the trust tier comes from the verification stamp.
  const project = env.registry.getProject(d.projectId as ProjectId);
  const resolution =
    project === null
      ? {
          resolutions: [],
          unresolvedSecret: false,
          hasRevoked: false,
          hasCrossWorkspace: false,
          resolverUnavailable: env.storeRoot === undefined,
        }
      : await resolveWritePointers({
          storeRoot: env.storeRoot,
          evidence: d.evidence ?? [],
          projectRootPath: project.rootPath,
          projectId: project.id,
          sessionId: null,
        });
  const verdict = verifyMemoryWrite({
    candidate: {
      id: "00000000-0000-4000-8000-000000000000" as MemoryEntryId,
      type: "project_rule",
      title: d.title,
      content: d.rule,
      keywords: [],
      relatedFiles: d.appliesTo ?? [],
    },
    callerConfidence: d.confidence ?? "medium",
    callerApproval: "approved",
    approvedActive: [],
    resolution,
    droppedCitedFiles: [],
  });

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
      confidence: minConfidence(
        d.confidence ?? "medium",
        WRITE_VERIFY_CONFIDENCE_CAP[verdict.outcome],
      ),
      createdFrom: d.createdFrom ?? "manual",
      verification: {
        outcome: verdict.outcome,
        reasons: [...verdict.reasons],
        verifiedAt: env.now(),
      },
      expiresAt: d.expiresAt !== undefined ? d.expiresAt : defaultWriteExpiresAt(env.now()),
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
