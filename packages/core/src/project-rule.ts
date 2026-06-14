import { projectRuleIdSchema, titleSchema } from "@megasaver/shared";
import { z } from "zod";
import { memoryConfidenceSchema } from "./memory-entry.js";

// Order: ascending blast radius (info < warning < critical). AA3: declaration
// order is a contract.
export const ruleSeveritySchema = z.enum(["info", "warning", "critical"]);
export type RuleSeverity = z.infer<typeof ruleSeveritySchema>;

// Order: roadmap declaration order (Phase 5 FORGE). Where a rule came from.
export const ruleCreatedFromSchema = z.enum(["manual", "failed_attempt", "test_failure"]);
export type RuleCreatedFrom = z.infer<typeof ruleCreatedFromSchema>;

// Confidence reuses the memory-entry enum (low|medium|high) — same trust ladder.
export const ruleConfidenceSchema = memoryConfidenceSchema;
export type RuleConfidence = z.infer<typeof ruleConfidenceSchema>;

export const projectRuleSchema = z
  .object({
    id: projectRuleIdSchema,
    workspaceKey: z.string().min(1),
    title: titleSchema,
    rule: z.string().trim().min(1),
    appliesTo: z.array(z.string()).default([]),
    evidence: z.array(z.string()).default([]),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema,
    createdFrom: ruleCreatedFromSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ProjectRule = z.infer<typeof projectRuleSchema>;

// Caller-supplied insight for convertFailureToRule: the rule fields the agent
// writes. id/workspaceKey/createdFrom/createdAt/updatedAt are engine-owned.
export const failureToRuleInputSchema = z
  .object({
    title: titleSchema,
    rule: z.string().trim().min(1),
    severity: ruleSeveritySchema,
    confidence: ruleConfidenceSchema.optional(),
    appliesTo: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
  })
  .strict();

export type FailureToRuleInput = z.infer<typeof failureToRuleInputSchema>;
