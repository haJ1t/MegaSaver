import { z } from "zod";

export type PriceTableErrorCode =
  | "missing_capture_date"
  | "unknown_fallback_unpriced"
  | "schema_invalid";

export class PriceTableError extends Error {
  readonly code: PriceTableErrorCode;
  constructor(code: PriceTableErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PriceTableError";
    this.code = code;
  }
}

export const modelPriceTableSchema = z.object({
  // Rendered with every estimate. A price table with no date is an undated claim.
  capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1),
  unknownModelId: z.string().min(1),
  prices: z.record(z.object({ inputPerMTokUsd: z.number().nonnegative() })),
});

export type ModelPriceTable = z.infer<typeof modelPriceTableSchema>;

// Published list input prices (USD / MTok). Bundle cannot read scripts/; the
// JSON stays for external harnesses; model-prices.test.ts pins them together
// — same rationale as BENCHMARK_RATES_PER_MTOK in benchmark-cost.ts.
export const MODEL_LIST_PRICES: ModelPriceTable = {
  capturedAt: "2026-08-01",
  source: "public pricing pages, USD per million input tokens",
  unknownModelId: "claude-sonnet-5",
  prices: {
    "claude-opus-5": { inputPerMTokUsd: 15.0 },
    "claude-sonnet-5": { inputPerMTokUsd: 3.0 },
    "claude-haiku-4-5": { inputPerMTokUsd: 0.8 },
  },
};

export function loadModelPriceTable(raw: unknown): ModelPriceTable {
  const parsed = modelPriceTableSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    if (path === "capturedAt") {
      throw new PriceTableError("missing_capture_date", "price table needs a capturedAt date");
    }
    throw new PriceTableError("schema_invalid", parsed.error.issues[0]?.message ?? "invalid table");
  }
  if (!parsed.data.prices[parsed.data.unknownModelId]) {
    throw new PriceTableError(
      "unknown_fallback_unpriced",
      `unknownModelId "${parsed.data.unknownModelId}" has no price entry`,
    );
  }
  return parsed.data;
}

export interface ResolvedPrice {
  usd: number;
  resolvedAs: "known" | "unknown";
}

// An unresolved model is priced at the declared fallback AND reported as
// unknown, so a window that is mostly unknown cannot read as mostly known.
export function inputPricePerMTok(table: ModelPriceTable, modelId?: string): ResolvedPrice {
  const hit = modelId ? table.prices[modelId] : undefined;
  if (hit) return { usd: hit.inputPerMTokUsd, resolvedAs: "known" };
  const fallback = table.prices[table.unknownModelId];
  if (!fallback) throw new PriceTableError("unknown_fallback_unpriced");
  return { usd: fallback.inputPerMTokUsd, resolvedAs: "unknown" };
}
