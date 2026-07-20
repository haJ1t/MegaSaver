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
  const pending = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current instanceof Lm2CleanupError) return true;
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    if (current.cause !== undefined) pending.push(current.cause);
    if (current instanceof AggregateError) pending.push(...current.errors);
  }
  return false;
}

export function combineLm2CleanupFailures(current: unknown, next: unknown): unknown {
  if (current === undefined) return next;
  const failures = current instanceof AggregateError ? [...current.errors, next] : [current, next];
  return new AggregateError(failures, "Multiple LM2 cleanup failures.");
}
