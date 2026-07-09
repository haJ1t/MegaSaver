// apps/cli/src/commands/alerts.ts
import type { KeyObject } from "node:crypto";
import { type FirewallEvent, firewallEventSchema } from "@megasaver/context-gate";
import { type StoredBudget, budgetStatus, readBudget } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { defaultReadFirewallLog } from "./firewall.js";
import {
  PRO_ANALYTICS_URL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./savings/index.js";

export const ALERTS_UPSELL = `Anomaly alerts are a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Boundary parse (§8): same local shape as cache.ts/firewall.ts (3 similar
// lines > premature abstraction); 3650 cap keeps date math in range.
export function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

export type ReadStoredBudget = (storeRoot: string) => {
  status: "absent" | "ok" | "corrupt";
  budget: StoredBudget | null;
};

const defaultReadStoredBudget: ReadStoredBudget = (root) => ({
  status: budgetStatus(root),
  budget: readBudget(root),
});

export type RunAlertsInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  days?: string;
  json?: boolean;
  readAllEvents: SavingsEventReader;
  readFirewallLog: (storeRoot: string) => string | null;
  readStoredBudget?: ReadStoredBudget;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runAlerts(input: RunAlertsInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(ALERTS_UPSELL);
    return 0;
  }

  let days: number | undefined;
  if (input.days !== undefined) {
    const parsed = parseDays(input.days);
    if (parsed === null) {
      input.stderr(
        `Invalid --days ${input.days}: expected a whole number of days between 1 and 3650.`,
      );
      return 1;
    }
    days = parsed;
  }

  const raw = input.readFirewallLog(input.storeRoot);
  const fwEvents: FirewallEvent[] = [];
  for (const line of raw === null ? [] : raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed);
    } catch {
      continue; // corrupt tail from a crashed writer must not kill the report
    }
    const result = firewallEventSchema.safeParse(parsedLine);
    if (result.success) fwEvents.push(result.data);
  }

  const budgetRead = (input.readStoredBudget ?? defaultReadStoredBudget)(input.storeRoot);
  let budget: {
    period: "month" | "week";
    goal: { kind: "tokens" | "dollars"; amount: number };
  } | null = null;
  if (budgetRead.status === "corrupt") {
    input.stderr(
      "stored budget unreadable (corrupt budget.json) — skipping the budget check; run `mega savings budget clear`.",
    );
  } else if (budgetRead.budget !== null) {
    budget = {
      period: budgetRead.budget.period,
      goal: { kind: budgetRead.budget.kind, amount: budgetRead.budget.amount },
    };
  }

  // Lazy import after the gate: never load the Pro compute on the free path.
  const { ALERT_MIN_HISTORY_DAYS, detectAnomalies } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const report = detectAnomalies(events, fwEvents, budget, {
    now: input.now(),
    ...(days === undefined ? {} : { windowDays: days }),
  });

  // --json is a stable contract: ALWAYS JSON, including the empty case.
  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (report.status === "insufficient-history") {
    input.stdout(
      `Not enough history yet (${report.historyDays.events} days recorded; needs ${ALERT_MIN_HISTORY_DAYS}).`,
    );
    return 0;
  }

  if (report.findings.length === 0) {
    input.stdout(`No anomalies in the last ${report.windowDays} days.`);
    if (report.insufficientAxes.length > 0) {
      input.stdout(`insufficient history (skipped): ${report.insufficientAxes.join(", ")}`);
    }
    return 0;
  }

  input.stdout(`Context alerts — last ${report.windowDays} days`);
  input.stdout("");
  for (const f of report.findings) {
    input.stdout(`  [${f.axis}] ${f.message}`);
  }
  if (report.insufficientAxes.length > 0) {
    input.stdout("");
    input.stdout(`insufficient history (skipped): ${report.insufficientAxes.join(", ")}`);
  }
  input.stdout("");
  for (const a of report.advice) {
    input.stdout(`fix: ${a}`);
  }
  return 0;
}

export const alertsCommand = defineCommand({
  meta: {
    name: "alerts",
    description:
      "Anomaly alerts — traffic/source/ratio/firewall spikes + budget pace (Mega Saver Pro).",
  },
  args: {
    days: { type: "string", description: "Window in days (default 30, max 3650)." },
    json: { type: "boolean", default: false, description: "Emit the AlertsReport as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runAlerts({
      storeRoot,
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(storeInput),
      readFirewallLog: defaultReadFirewallLog,
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
