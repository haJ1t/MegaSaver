import { z } from "zod";

export const MAX_OBSERVATION_TEXT_CHARS = 50_000;
export const MAX_WORKSPACE_KEY_LENGTH = 256;
export const MAX_EVIDENCE_ID_LENGTH = 512;
export const MAX_EVIDENCE_IDS = 1_000;
export const MAX_RECALL_TASK_CHARS = 20_000;
export const MAX_RECALL_TOKEN_BUDGET = 100_000;

export const observationKindSchema = z.enum(["state_snapshot", "state_transition"]);
export type ObservationKind = z.infer<typeof observationKindSchema>;

export const observationSchema = z
  .object({
    id: z.string().uuid(),
    workspaceKey: z.string().trim().min(1).max(MAX_WORKSPACE_KEY_LENGTH),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    kind: observationKindSchema,
    observedAt: z.string().datetime({ offset: true }),
    text: z.string().trim().min(1).max(MAX_OBSERVATION_TEXT_CHARS),
    evidenceIds: z
      .array(z.string().trim().min(1).max(MAX_EVIDENCE_ID_LENGTH))
      .min(1)
      .max(MAX_EVIDENCE_IDS),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;

export const recallRequestSchema = z
  .object({
    task: z.string().trim().min(1).max(MAX_RECALL_TASK_CHARS),
    workspaceKey: z.string().trim().min(1).max(MAX_WORKSPACE_KEY_LENGTH),
    tokenBudget: z.number().int().positive().max(MAX_RECALL_TOKEN_BUDGET),
  })
  .strict();
export type RecallRequest = z.infer<typeof recallRequestSchema>;

export const recallItemSchema = z
  .object({
    type: z.literal("text"),
    value: z.string().trim().min(1),
    observationId: z.string().uuid(),
  })
  .strict();
export type RecallItem = z.infer<typeof recallItemSchema>;

export const receiptItemSchema = z
  .object({
    observationId: z.string().uuid(),
    evidenceIds: z.array(z.string().min(1)).min(1),
    lane: z.literal("state"),
    tokenEstimate: z.number().int().positive(),
  })
  .strict();
export type ReceiptItem = z.infer<typeof receiptItemSchema>;

export const recallBundleSchema = z
  .object({ items: z.array(recallItemSchema), receipt: z.array(receiptItemSchema) })
  .strict();
export type RecallBundle = z.infer<typeof recallBundleSchema>;

export const rpcRequestSchema = z.discriminatedUnion("op", [
  z
    .object({
      id: z.string().min(1),
      op: z.literal("insert"),
      observation: observationSchema,
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      op: z.literal("query"),
      request: recallRequestSchema,
    })
    .strict(),
]);
export type RpcRequest = z.infer<typeof rpcRequestSchema>;

export const rpcResponseSchema = z.union([
  z
    .object({
      id: z.string().min(1),
      ok: z.literal(true),
      result: z.union([z.object({ inserted: z.boolean() }).strict(), recallBundleSchema]),
    })
    .strict(),
  z
    .object({
      id: z.string().nullable(),
      ok: z.literal(false),
      error: z.object({ code: z.enum(["invalid_request", "not_found", "internal"]) }).strict(),
    })
    .strict(),
]);
export type RpcResponse = z.infer<typeof rpcResponseSchema>;
