import { z } from "zod";

export const costFacetSchema = z.enum(["project", "task", "agent", "session"]);
export type CostFacet = z.infer<typeof costFacetSchema>;

// Attribution is never guessed: a receipt whose row carries no signal for the
// requested facet lands here, and the renderer prints the bucket explicitly.
export const UNKNOWN_COST_BUCKET = "UNKNOWN";

export interface SpendReceipt {
  ts: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  workspaceKey?: string | undefined;
}

export interface SavingsReceipt {
  createdAt: string;
  project?: string | undefined;
  session?: string | undefined;
  // Present iff the writer measured a real before/after token pair
  // (deltaTokensOf semantics — never a bytes/4 reconstruction).
  deltaTokens?: number | undefined;
}

export interface CostSessionMeta {
  agent?: string | undefined;
  task?: string | undefined;
}

export interface CostLedgerGroup {
  key: string;
  spendReceipts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  measuredSavedTokens: number;
  measuredSavingsReceipts: number;
  unmeasuredSavingsRows: number;
}

export type CostLedgerTotals = Omit<CostLedgerGroup, "key">;

export interface CostLedger {
  facet: CostFacet;
  sinceMs: number | undefined;
  groups: readonly CostLedgerGroup[];
  totals: CostLedgerTotals;
  skippedUsageLines: number;
}

export interface BuildCostLedgerInput {
  facet: CostFacet;
  sinceMs?: number | undefined;
  usage: readonly SpendReceipt[];
  savings: readonly SavingsReceipt[];
  sessionMeta: ReadonlyMap<string, CostSessionMeta>;
  skippedUsageLines: number;
}

function emptyGroup(key: string): CostLedgerGroup {
  return {
    key,
    spendReceipts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    measuredSavedTokens: 0,
    measuredSavingsReceipts: 0,
    unmeasuredSavingsRows: 0,
  };
}

function inWindow(iso: string, sinceMs: number | undefined): boolean {
  if (sinceMs === undefined) return true;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= sinceMs;
}

// Usage rows carry no session/agent/task signal; workspaceKey is the only
// attribution a row can carry today (F33, llm-proxy usage-event.ts) and it
// only serves --by project.
function spendKey(facet: CostFacet, receipt: SpendReceipt): string {
  if (facet === "project" && receipt.workspaceKey !== undefined) {
    return receipt.workspaceKey;
  }
  return UNKNOWN_COST_BUCKET;
}

function savingsKey(
  facet: CostFacet,
  receipt: SavingsReceipt,
  meta: ReadonlyMap<string, CostSessionMeta>,
): string {
  if (facet === "project") return receipt.project ?? UNKNOWN_COST_BUCKET;
  if (facet === "session") return receipt.session ?? UNKNOWN_COST_BUCKET;
  const m = receipt.session === undefined ? undefined : meta.get(receipt.session);
  const value = facet === "agent" ? m?.agent : m?.task;
  return value ?? UNKNOWN_COST_BUCKET;
}

const spendTokens = (g: CostLedgerGroup): number =>
  g.inputTokens + g.outputTokens + g.cacheReadTokens + g.cacheCreationTokens;

export function buildCostLedger(input: BuildCostLedgerInput): CostLedger {
  const groups = new Map<string, CostLedgerGroup>();
  const group = (key: string): CostLedgerGroup => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created = emptyGroup(key);
    groups.set(key, created);
    return created;
  };

  for (const receipt of input.usage) {
    if (!inWindow(receipt.ts, input.sinceMs)) continue;
    const g = group(spendKey(input.facet, receipt));
    g.spendReceipts += 1;
    g.inputTokens += receipt.inputTokens;
    g.outputTokens += receipt.outputTokens;
    g.cacheReadTokens += receipt.cacheReadTokens;
    g.cacheCreationTokens += receipt.cacheCreationTokens;
  }

  for (const receipt of input.savings) {
    if (!inWindow(receipt.createdAt, input.sinceMs)) continue;
    const g = group(savingsKey(input.facet, receipt, input.sessionMeta));
    if (receipt.deltaTokens === undefined) {
      g.unmeasuredSavingsRows += 1;
    } else {
      g.measuredSavedTokens += receipt.deltaTokens;
      g.measuredSavingsReceipts += 1;
    }
  }

  const named = [...groups.values()].filter((g) => g.key !== UNKNOWN_COST_BUCKET);
  named.sort(
    (a, b) =>
      spendTokens(b) - spendTokens(a) ||
      b.measuredSavedTokens - a.measuredSavedTokens ||
      a.key.localeCompare(b.key),
  );
  const unknown = groups.get(UNKNOWN_COST_BUCKET);
  const ordered = unknown ? [...named, unknown] : named;

  const totals: CostLedgerTotals = {
    spendReceipts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    measuredSavedTokens: 0,
    measuredSavingsReceipts: 0,
    unmeasuredSavingsRows: 0,
  };
  for (const g of ordered) {
    totals.spendReceipts += g.spendReceipts;
    totals.inputTokens += g.inputTokens;
    totals.outputTokens += g.outputTokens;
    totals.cacheReadTokens += g.cacheReadTokens;
    totals.cacheCreationTokens += g.cacheCreationTokens;
    totals.measuredSavedTokens += g.measuredSavedTokens;
    totals.measuredSavingsReceipts += g.measuredSavingsReceipts;
    totals.unmeasuredSavingsRows += g.unmeasuredSavingsRows;
  }

  return {
    facet: input.facet,
    sinceMs: input.sinceMs,
    groups: ordered,
    totals,
    skippedUsageLines: input.skippedUsageLines,
  };
}
