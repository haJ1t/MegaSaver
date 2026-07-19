import { z } from "zod";

export const observationKindSchema = z.enum(["state_snapshot", "state_transition"]);
export type ObservationKind = z.infer<typeof observationKindSchema>;

export const observationSchema = z
  .object({
    id: z.string().uuid(),
    workspaceKey: z.string().min(1),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    kind: observationKindSchema,
    observedAt: z.string().datetime({ offset: true }),
    text: z.string().trim().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;

export const recallRequestSchema = z
  .object({
    task: z.string().trim().min(1),
    workspaceKey: z.string().min(1),
    tokenBudget: z.number().int().positive(),
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
      error: z.object({ code: z.literal("invalid_request") }).strict(),
    })
    .strict(),
]);
export type RpcResponse = z.infer<typeof rpcResponseSchema>;
