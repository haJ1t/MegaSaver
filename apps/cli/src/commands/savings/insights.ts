import type { KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  type CodeTruthTotalsReader,
  type GuardTotalsReader,
  PRO_ANALYTICS_UPSELL,
  type SavingsEventReader,
  type WarmStartTotalsReader,
  defaultCodeTruthTotalsReader,
  defaultGuardTotalsReader,
  defaultSavingsEventReader,
  defaultWarmStartTotalsReader,
  formatCodeTruthLine,
  formatGuardLine,
  formatWarmStartLine,
} from "./shared.js";

export type InsightsBy = "source" | "label";

export type RunSavingsInsightsInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  readWarmStartTotals?: WarmStartTotalsReader;
  readGuardTotals?: GuardTotalsReader;
  readCodeTruthTotals?: CodeTruthTotalsReader;
  by?: InsightsBy;
  json?: boolean;
  csv?: boolean;
  out?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const TABLE_COLUMNS = [
  "key",
  "events",
  "tokensReturned",
  "dollarsReturned",
  "tokensSaved",
  "dollarsSaved",
  "savingRatio",
  "returnedShare",
] as const;

// $ columns floored to the shared display string (formatDollarsSaved), matching
// history.ts + `mega audit report`; ratios to 2dp; everything else verbatim.
function fmt(column: string, value: unknown): string {
  if (column === "dollarsReturned" || column === "dollarsSaved") {
    return formatDollarsSaved(value as number);
  }
  if (column === "savingRatio" || column === "returnedShare") {
    return (value as number).toFixed(2);
  }
  return String(value);
}

function renderTable(rows: readonly Record<string, unknown>[]): string[] {
  const header = TABLE_COLUMNS.join("  ");
  const lines = rows.map((row) => TABLE_COLUMNS.map((c) => fmt(c, row[c])).join("  "));
  return [header, ...lines];
}

export async function runSavingsInsights(input: RunSavingsInsightsInput): Promise<0 | 1> {
  // The entitlement gate runs FIRST. On the not-entitled path we print an honest
  // upsell and return 0 without importing pro-analytics or reading any events —
  // the Pro compute must never half-run for a free user.
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(PRO_ANALYTICS_UPSELL);
    return 0;
  }

  const { computeWasteBreakdown, computeWasteHeadline, exportSavings } = await import(
    "@megasaver/pro-analytics"
  );

  const { events } = await input.readAllEvents();
  const by: InsightsBy = input.by ?? "source";
  const rows = computeWasteBreakdown(events, { by });
  const headline = computeWasteHeadline(events);

  if (rows.length === 0) {
    input.stdout("No savings recorded yet.");
    return 0;
  }

  let rendered: string;
  if (input.json) {
    rendered = JSON.stringify({ headline, rows });
  } else if (input.csv) {
    rendered = exportSavings(rows as unknown as Parameters<typeof exportSavings>[0], "csv");
  } else {
    // rows.length > 0 here, so the source breakdown is non-empty and topKey is
    // non-null (topKey is null only for empty events, handled by the return above).
    const headlineLine = `Still sending ${headline.tokensReturned} tokens (${formatDollarsSaved(headline.dollarsReturned)}) to the model. Biggest source: ${headline.topKey} (${(headline.topReturnedShare * 100).toFixed(0)}% of returned bytes, ${(headline.overallSavingRatio * 100).toFixed(0)}% overall saved).`;
    rendered = [
      headlineLine,
      "",
      ...renderTable(rows as unknown as Record<string, unknown>[]),
    ].join("\n");
    if (input.readWarmStartTotals !== undefined) {
      const warmLine = formatWarmStartLine(await input.readWarmStartTotals());
      if (warmLine !== null) rendered = `${rendered}\n\n${warmLine}`;
    }
    if (input.readGuardTotals !== undefined) {
      const guardLine = formatGuardLine(await input.readGuardTotals());
      if (guardLine !== null) rendered = `${rendered}\n\n${guardLine}`;
    }
    if (input.readCodeTruthTotals !== undefined) {
      const codeTruthLine = formatCodeTruthLine(await input.readCodeTruthTotals());
      if (codeTruthLine !== null) rendered = `${rendered}\n\n${codeTruthLine}`;
    }
  }

  if (input.out !== undefined) {
    writeFileSync(input.out, rendered);
    input.stdout(`Wrote savings insights to ${input.out}`);
  } else {
    input.stdout(rendered);
  }
  return 0;
}

export const savingsInsightsCommand = defineCommand({
  meta: {
    name: "insights",
    description: "Where tokens are still spent — waste breakdown (Mega Saver Pro).",
  },
  args: {
    by: { type: "string", description: "source | label (default: source)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    csv: { type: "boolean", default: false, description: "Emit CSV output." },
    out: { type: "string", description: "Write output to a file instead of stdout." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const by = typeof args.by === "string" ? args.by : undefined;
    const code = await runSavingsInsights({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      readWarmStartTotals: defaultWarmStartTotalsReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      readGuardTotals: defaultGuardTotalsReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      readCodeTruthTotals: defaultCodeTruthTotalsReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      ...(by === "source" || by === "label" ? { by } : {}),
      json: !!args.json,
      csv: !!args.csv,
      ...(typeof args.out === "string" ? { out: args.out } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
