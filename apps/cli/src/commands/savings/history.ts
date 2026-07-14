import type { KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  type GuardTotalsReader,
  PRO_ANALYTICS_UPSELL,
  type SavingsEventReader,
  type WarmStartTotalsReader,
  defaultGuardTotalsReader,
  defaultSavingsEventReader,
  defaultWarmStartTotalsReader,
  formatGuardLine,
  formatWarmStartLine,
} from "./shared.js";

export type HistoryBy = "day" | "week" | "project";

export type RunSavingsHistoryInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  readWarmStartTotals?: WarmStartTotalsReader;
  readGuardTotals?: GuardTotalsReader;
  by?: HistoryBy;
  json?: boolean;
  csv?: boolean;
  out?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// The $ column is floored to the shared display string (formatDollarsSaved) so
// the history table agrees with `mega audit report` / the GUI strip; every other
// column stringifies as-is.
function renderTable(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): string[] {
  const header = columns.join("  ");
  const lines = rows.map((row) =>
    columns
      .map((c) => (c === "dollarsSaved" ? formatDollarsSaved(row[c] as number) : String(row[c])))
      .join("  "),
  );
  return [header, ...lines];
}

export async function runSavingsHistory(input: RunSavingsHistoryInput): Promise<0 | 1> {
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

  const { computeSavingsHistory, computeSavingsByProject, exportSavings } = await import(
    "@megasaver/pro-analytics"
  );

  const { events, eventsByProject } = await input.readAllEvents();
  const by: HistoryBy = input.by ?? "day";

  const rows =
    by === "project"
      ? computeSavingsByProject(eventsByProject)
      : computeSavingsHistory(events, { bucket: by });

  if (rows.length === 0) {
    input.stdout("No savings recorded yet.");
    return 0;
  }

  const columns =
    by === "project"
      ? ["project", "tokensSaved", "dollarsSaved", "events"]
      : ["bucket", "tokensSaved", "dollarsSaved", "events"];

  let rendered: string;
  if (input.json) {
    rendered = JSON.stringify(rows);
  } else if (input.csv) {
    rendered = exportSavings(rows, "csv");
  } else {
    rendered = renderTable(rows as unknown as Record<string, unknown>[], columns).join("\n");
    if (input.readWarmStartTotals !== undefined) {
      const warmLine = formatWarmStartLine(await input.readWarmStartTotals());
      if (warmLine !== null) rendered = `${rendered}\n\n${warmLine}`;
    }
    if (input.readGuardTotals !== undefined) {
      const guardLine = formatGuardLine(await input.readGuardTotals());
      if (guardLine !== null) rendered = `${rendered}\n\n${guardLine}`;
    }
  }

  if (input.out !== undefined) {
    writeFileSync(input.out, rendered);
    input.stdout(`Wrote savings history to ${input.out}`);
  } else {
    input.stdout(rendered);
  }
  return 0;
}

export const savingsHistoryCommand = defineCommand({
  meta: { name: "history", description: "Historical savings analytics (Mega Saver Pro)." },
  args: {
    by: { type: "string", description: "day | week | project (default: day)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    csv: { type: "boolean", default: false, description: "Emit CSV output." },
    out: { type: "string", description: "Write output to a file instead of stdout." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const by = typeof args.by === "string" ? args.by : undefined;
    const code = await runSavingsHistory({
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
      ...(by === "day" || by === "week" || by === "project" ? { by } : {}),
      json: !!args.json,
      csv: !!args.csv,
      ...(typeof args.out === "string" ? { out: args.out } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
