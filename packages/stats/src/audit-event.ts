import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

const auditEventBase = {
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  projectId: projectIdSchema,
  createdAt: z.string().datetime({ offset: true }),
};

export const contextPackBuiltEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("context_pack_built"),
    filesConsidered: z.number().int().nonnegative(),
    filesIncluded: z.number().int().nonnegative(),
    filesExcluded: z.number().int().nonnegative(),
    blocksConsidered: z.number().int().nonnegative(),
    blocksIncluded: z.number().int().nonnegative(),
    blocksExcluded: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
  })
  .strict();

export const ruleAppliedEventSchema = z
  .object({ ...auditEventBase, kind: z.literal("rule_applied") })
  .strict();

export const failureAvoidedEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("failure_avoided"),
    retryTokensAvoided: z.number().int().nonnegative(),
  })
  .strict();

export const memoryRetrievedEventSchema = z
  .object({ ...auditEventBase, kind: z.literal("memory_retrieved") })
  .strict();

export const toolRouteEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("tool_route"),
    toolsConsidered: z.number().int().nonnegative(),
    toolsAllowed: z.number().int().nonnegative(),
    toolSchemasReduced: z.number().int().nonnegative(),
  })
  .strict();

export const auditEventSchema = z.discriminatedUnion("kind", [
  contextPackBuiltEventSchema,
  ruleAppliedEventSchema,
  failureAvoidedEventSchema,
  memoryRetrievedEventSchema,
  toolRouteEventSchema,
]);

export type AuditEvent = z.infer<typeof auditEventSchema>;
