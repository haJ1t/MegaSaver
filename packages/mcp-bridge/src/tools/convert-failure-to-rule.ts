import {
  type CoreRegistry,
  CoreRegistryError,
  WRITE_VERIFY_CONFIDENCE_CAP,
  minConfidence,
  ruleConfidenceSchema,
  ruleSeveritySchema,
  verifyMemoryWrite,
} from "@megasaver/core";
import { type MemoryEntryId, failedAttemptIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { resolveWritePointers } from "../write-verify-resolver.js";

export type ConvertFailureToRuleEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  // Absent ⇒ resolver_unavailable ⇒ the rule can never verify (write still lands).
  storeRoot?: string;
};

export const inputSchema = z
  .object({
    failureId: z.string().min(1),
    title: z.string().min(1),
    rule: z.string().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).max(32).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "failed_attempt_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    // already_converted, project_rule_already_exists
    return new McpBridgeError("validation_failed", err.message);
  }
  if (err instanceof Error) return new McpBridgeError("validation_failed", err.message);
  return new McpBridgeError("validation_failed", "convert_failure_to_rule failed");
}

export async function handleConvertFailureToRule(
  env: ConvertFailureToRuleEnv,
  rawArgs: unknown,
): Promise<{ ruleId: string; failureId: string }> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const d = parsed.data;
  const failureId = failedAttemptIdSchema.safeParse(d.failureId);
  if (!failureId.success) {
    throw new McpBridgeError("validation_failed", `invalid failureId: ${d.failureId}`);
  }
  try {
    // Write gate (rules are ALWAYS gated, evidence only, no conflict corpus):
    // the gate NEVER drops the rule — unverified verdicts cap confidence and
    // stamp verification. A missing failure falls through to the registry's
    // existing failed_attempt_not_found mapping.
    const failure = env.registry.getFailedAttempt(failureId.data);
    const project = failure === null ? null : env.registry.getProject(failure.projectId);
    const resolution =
      failure === null || project === null
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
            projectId: failure.projectId,
            sessionId: null,
          });
    const verdict = verifyMemoryWrite({
      candidate: {
        id: env.newId() as MemoryEntryId,
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
    const { rule, failure: flipped } = env.registry.convertFailureToRule(
      failureId.data,
      {
        title: d.title,
        rule: d.rule,
        severity: d.severity,
        confidence: minConfidence(
          d.confidence ?? "medium",
          WRITE_VERIFY_CONFIDENCE_CAP[verdict.outcome],
        ),
        verification: {
          outcome: verdict.outcome,
          reasons: [...verdict.reasons],
          verifiedAt: env.now(),
        },
        ...(d.appliesTo !== undefined ? { appliesTo: d.appliesTo } : {}),
        ...(d.evidence !== undefined ? { evidence: d.evidence } : {}),
        ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}),
      },
      { now: env.now, newId: env.newId },
    );
    return { ruleId: rule.id, failureId: flipped.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}
