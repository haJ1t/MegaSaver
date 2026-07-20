import type { Lm2PendingAllocation } from "./lm2-quota-ledger.js";

export class Lm2CleanupError extends Error {
  readonly entries: readonly Lm2PendingAllocation[];

  constructor(message: string, cause: unknown, entries: readonly Lm2PendingAllocation[] = []) {
    super(message, { cause });
    this.name = "Lm2CleanupError";
    this.entries = [...entries];
  }
}

export function isLm2CleanupError(error: unknown): boolean {
  let current = error;
  const seen = new Set<object>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof Lm2CleanupError) return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
}
