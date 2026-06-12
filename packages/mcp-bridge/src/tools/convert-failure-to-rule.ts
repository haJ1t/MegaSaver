import {
  type CoreRegistry,
  CoreRegistryError,
  ruleConfidenceSchema,
  ruleSeveritySchema,
} from "@megasaver/core";
import { failedAttemptIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type ConvertFailureToRuleEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
};

const inputSchema = z
  .object({
    failureId: z.string().min(1),
    title: z.string().min(1),
    rule: z.string().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
  })
  .strict();

function mapCoreError(err: unknown): McpBridgeError {
  if (err instanceof CoreRegistryError) {
    if (err.code === "failed_attempt_not_found") {
      return new McpBridgeError("resource_not_found", err.message);
    }
    // already_converted, project_rule_already_exists, project_not_found
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
    const { rule, failure } = env.registry.convertFailureToRule(
      failureId.data,
      {
        title: d.title,
        rule: d.rule,
        severity: d.severity,
        ...(d.confidence !== undefined ? { confidence: d.confidence } : {}),
        ...(d.appliesTo !== undefined ? { appliesTo: d.appliesTo } : {}),
        ...(d.evidence !== undefined ? { evidence: d.evidence } : {}),
      },
      { now: env.now, newId: env.newId },
    );
    return { ruleId: rule.id, failureId: failure.id };
  } catch (err) {
    throw mapCoreError(err);
  }
}
