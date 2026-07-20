import { isAbsolute } from "node:path";
import { z } from "zod";
import { BENCHMARK_DATA_REVISION } from "./lm2-benchmark-manifest.js";
import { modelDescriptorSchema } from "./lm2-model.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/u);
export const benchmarkConfigSchema = z
  .object({
    manifestPath: z.string().refine(isAbsolute),
    manifestDigest: sha256Schema,
    dataRevision: z.literal(BENCHMARK_DATA_REVISION),
    cacheParent: z.string().refine(isAbsolute),
    profile: z.enum(["safe", "adaptive"]),
    embeddingEgress: z.literal("local"),
    model: modelDescriptorSchema.refine((model) => model.provider === "local"),
    tokenBudget: z.number().int().min(1).max(100_000),
    queryTimeoutMs: z.number().int().min(1).max(2_000),
    indexBatchTimeoutMs: z.number().int().min(1).max(15_000),
  })
  .strict();
export type BenchmarkConfig = z.infer<typeof benchmarkConfigSchema>;

const common = {
  id: z.string().trim().min(1).max(256),
  config: benchmarkConfigSchema,
  instanceToken: tokenSchema,
};
const existing = {
  ...common,
  sentinelToken: tokenSchema,
  expectedChainDigest: sha256Schema,
};
export const benchmarkRequestSchema = z.discriminatedUnion("op", [
  z.object({ ...common, op: z.literal("open") }).strict(),
  z
    .object({
      ...existing,
      op: z.literal("insert"),
      trajectory: z.record(z.unknown()),
    })
    .strict(),
  z
    .object({
      ...existing,
      op: z.literal("query"),
      questionId: z.string().trim().min(1).max(256),
      query: z.string().trim().min(1).max(20_000),
      queryImagePresent: z.boolean(),
    })
    .strict(),
]);
export type BenchmarkRequest = z.infer<typeof benchmarkRequestSchema>;

export class BenchmarkTransportError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "invalid_config"
      | "state_rejected"
      | "query_rejected"
      | "operation_failed",
  ) {
    super(code);
    this.name = "BenchmarkTransportError";
  }
}

export function parseBenchmarkRequest(value: unknown): BenchmarkRequest {
  const parsed = benchmarkRequestSchema.safeParse(value);
  if (!parsed.success) throw new BenchmarkTransportError("invalid_request");
  return parsed.data;
}
