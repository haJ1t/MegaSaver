import type { Lm2IndexReceipt } from "./lm2-model.js";

type QuotaRecovery = Lm2IndexReceipt["quotaRecovery"];
type RetryReason = Extract<Lm2IndexReceipt, { outcome: "retry" }>["transientReason"];

export function retryIndexReceipt(input: {
  indexedCount?: number;
  omitted?: readonly { id: string; reason: string }[];
  retryCursor: string | null;
  reason: RetryReason;
  quotaRecovery: QuotaRecovery;
}): Lm2IndexReceipt {
  return {
    indexedCount: input.indexedCount ?? 0,
    omitted: [...(input.omitted ?? [])],
    outcome: "retry",
    nextCursor: null,
    retryCursor: input.retryCursor,
    transientReason: input.reason,
    quotaRecovery: input.quotaRecovery,
  };
}

export function terminalIndexReceipt(input: {
  indexedCount: number;
  omitted: readonly { id: string; reason: string }[];
  nextCursor: string | null;
  quotaRecovery: QuotaRecovery;
}): Lm2IndexReceipt {
  const fields = {
    indexedCount: input.indexedCount,
    omitted: [...input.omitted],
    retryCursor: null,
    transientReason: null,
    quotaRecovery: input.quotaRecovery,
  };
  return input.nextCursor === null
    ? { ...fields, outcome: "complete", nextCursor: null }
    : { ...fields, outcome: "continue", nextCursor: input.nextCursor };
}

export function expiredIndexReceipt(quotaRecovery: QuotaRecovery): Lm2IndexReceipt {
  return {
    indexedCount: 0,
    omitted: [],
    outcome: "expired",
    nextCursor: null,
    retryCursor: null,
    transientReason: null,
    quotaRecovery,
  };
}
