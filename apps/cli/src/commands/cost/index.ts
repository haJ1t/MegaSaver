import {
  type CostFacet,
  type CostLedger,
  type CostLedgerTotals,
  type CostSessionMeta,
  type SavingsReceipt,
  buildCostLedger,
  costFacetSchema,
} from "@megasaver/core";
import { type ProxyUsageEvent, readProxyUsage } from "@megasaver/llm-proxy";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { readCostCache, savingsFingerprint, writeCostCache } from "./cache.js";
import {
  collectSavingsReceipts,
  collectSessionMeta,
  parseSince,
  toSpendReceipts,
} from "./collect.js";

export type RunCostInput = {
  storeRoot: string;
  by: CostFacet;
  sinceMs?: number | undefined;
  json: boolean;
  cache?: boolean;
  readUsage?: typeof readProxyUsage;
  readSavings?: (storeRoot: string) => SavingsReceipt[];
  readMeta?: (storeRoot: string) => Map<string, CostSessionMeta>;
};

const n = (x: number): string => x.toLocaleString("en-US");
const WIDTHS = [22, 11, 12, 10, 12, 12, 12, 11, 10] as const;

function row(cells: readonly string[]): string {
  return cells
    .map((cell, i) => {
      const w = WIDTHS[i] ?? 12;
      return i === 0 ? cell.padEnd(w) : cell.padStart(w);
    })
    .join("  ")
    .trimEnd();
}

function groupCells(label: string, g: CostLedgerTotals): string[] {
  return [
    label,
    n(g.spendReceipts),
    n(g.inputTokens),
    n(g.outputTokens),
    n(g.cacheReadTokens),
    n(g.cacheCreationTokens),
    g.measuredSavingsReceipts > 0 ? n(g.measuredSavedTokens) : "—",
    n(g.measuredSavingsReceipts),
    n(g.unmeasuredSavingsRows),
  ];
}

export function renderCostTable(ledger: CostLedger): string {
  const t = ledger.totals;
  const receiptsTotal = t.spendReceipts + t.measuredSavingsReceipts + t.unmeasuredSavingsRows;
  const skipNote =
    ledger.skippedUsageLines > 0
      ? ["", `⚠ ${ledger.skippedUsageLines} unreadable usage lines skipped`]
      : [];
  if (receiptsTotal === 0) {
    return [
      "No receipts recorded yet (or none in this window).",
      "Spend receipts come from `mega proxy start` (point your agent at it);",
      "savings receipts come from the saver hook/tools.",
      ...skipNote,
    ].join("\n");
  }
  const lines: string[] = [
    `cost by ${ledger.facet} — receipts only (tokens, not dollars)`,
    "",
    row(["group", "spend-rcpts", "input", "output", "cache-read", "cache-write", "saved", "saved-rcpts", "unmeasured"]),
  ];
  for (const g of ledger.groups) {
    lines.push(row(groupCells(g.key, g)));
  }
  lines.push(row(groupCells("total", t)));
  lines.push(
    "",
    `receipts: ${n(receiptsTotal)} (${n(t.spendReceipts)} spend, ${n(t.measuredSavingsReceipts)} measured savings, ${n(t.unmeasuredSavingsRows)} unmeasured savings rows)`,
    "UNKNOWN: receipts carrying no attribution for this grouping — never guessed.",
    "saved counts only rows with a measured before/after token pair; unmeasured",
    "rows are counted above, never converted or extrapolated.",
    ...skipNote,
  );
  return lines.join("\n");
}

export async function runCost(input: RunCostInput): Promise<string> {
  const readUsage = input.readUsage ?? readProxyUsage;
  const readMeta = input.readMeta ?? collectSessionMeta;

  let usageEvents: readonly ProxyUsageEvent[] = [];
  let skippedUsageLines = 0;
  try {
    const read = await readUsage({ storeRoot: input.storeRoot });
    usageEvents = read.events;
    skippedUsageLines = read.skippedLines;
  } catch {
    // No usage log yet.
  }

  let savings: SavingsReceipt[];
  if (input.readSavings) {
    savings = input.readSavings(input.storeRoot);
  } else if (input.cache === true) {
    const fingerprint = savingsFingerprint(input.storeRoot);
    const cached = readCostCache(input.storeRoot, fingerprint);
    if (cached === undefined) {
      savings = collectSavingsReceipts(input.storeRoot);
      writeCostCache(input.storeRoot, fingerprint, savings);
    } else {
      savings = cached;
    }
  } else {
    savings = collectSavingsReceipts(input.storeRoot);
  }

  const ledger = buildCostLedger({
    facet: input.by,
    sinceMs: input.sinceMs,
    usage: toSpendReceipts(usageEvents),
    savings,
    sessionMeta: readMeta(input.storeRoot),
    skippedUsageLines,
  });

  return input.json ? JSON.stringify(ledger) : renderCostTable(ledger);
}

export const costCommand = defineCommand({
  meta: {
    name: "cost",
    description: "Unified cost ledger: spend + savings receipts by project, task, agent, session.",
  },
  args: {
    by: {
      type: "string",
      default: "project",
      description: "Group by: project | task | agent | session.",
    },
    since: { type: "string", description: "Window start: ISO 8601, or <N>d / <N>h." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    cache: {
      type: "boolean",
      default: false,
      description: "Use the optional mtime-keyed savings cache.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const facet = costFacetSchema.safeParse(args.by);
    if (!facet.success) {
      process.stderr.write(`invalid --by value: ${String(args.by)} (use project|task|agent|session)\n`);
      process.exitCode = 1;
      return;
    }
    let sinceMs: number | undefined;
    if (typeof args.since === "string") {
      sinceMs = parseSince(args.since, Date.now());
      if (sinceMs === undefined) {
        process.stderr.write(`invalid --since value: ${args.since} (use ISO 8601, <N>d or <N>h)\n`);
        process.exitCode = 1;
        return;
      }
    }
    const storeEnv = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    let storeRoot: string;
    try {
      storeRoot = resolveStorePath(storeEnv);
    } catch {
      storeRoot = "";
    }
    const out = await runCost({
      storeRoot,
      by: facet.data,
      sinceMs,
      json: args.json ?? false,
      cache: args.cache ?? false,
    });
    process.stdout.write(`${out}\n`);
  },
});
