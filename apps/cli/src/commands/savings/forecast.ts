import type { KeyObject } from "node:crypto";
import { type StoredBudget, budgetStatus, formatDollarsSaved, readBudget } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  PRO_ANALYTICS_UPSELL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./shared.js";

export type ForecastPeriodArg = "month" | "week";

export type ParsedGoal = { kind: "tokens" | "dollars"; amount: number };

// Boundary parse (§8): the renderer divides by the goal, so reject a non-finite
// or non-positive amount here rather than emit NaN%. `$`-prefixed → dollars.
export function parseGoal(raw: string): ParsedGoal | null {
  const isDollars = raw.startsWith("$");
  const amount = Number(isDollars ? raw.slice(1) : raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { kind: isDollars ? "dollars" : "tokens", amount };
}

export type RunSavingsForecastInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  period?: ForecastPeriodArg;
  goal?: string;
  json?: boolean;
  readStoredBudget?: (storeRoot: string) => {
    status: "absent" | "ok" | "corrupt";
    budget: StoredBudget | null;
  };
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSavingsForecast(input: RunSavingsForecastInput): Promise<0 | 1> {
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

  let goal: ParsedGoal | null = null;
  if (input.goal !== undefined) {
    goal = parseGoal(input.goal);
    if (goal === null) {
      input.stderr(
        `Invalid --goal ${input.goal}: expected a positive number of tokens or $dollars.`,
      );
      return 1;
    }
  }

  // Stored-budget auto-load (1.13): explicit flags always win; the stored
  // budget only fills the gaps. Corrupt file → honest note, treated as absent.
  let goalSource: "flag" | "stored" | null = goal === null ? null : "flag";
  let storedPeriod: ForecastPeriodArg | undefined;
  if (goal === null || input.period === undefined) {
    const readStored =
      input.readStoredBudget ??
      ((root: string) => ({ status: budgetStatus(root), budget: readBudget(root) }));
    const storedRead = readStored(input.storeRoot);
    if (storedRead.status === "corrupt") {
      input.stderr(
        "stored budget unreadable (corrupt budget.json) — ignoring; run `mega savings budget clear`.",
      );
    } else if (storedRead.budget !== null) {
      if (goal === null) {
        goal = { kind: storedRead.budget.kind, amount: storedRead.budget.amount };
        goalSource = "stored";
      }
      if (input.period === undefined) {
        storedPeriod = storedRead.budget.period;
      }
    }
  }

  const { forecastSavings, budgetPace } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const period: ForecastPeriodArg = input.period ?? storedPeriod ?? "month";
  const forecast = forecastSavings(events, { now: input.now(), period });
  const pace = goal ? budgetPace(forecast, goal) : null;

  if (input.json) {
    input.stdout(JSON.stringify(pace ? { forecast, pace, goalSource } : { forecast }));
    return 0;
  }

  if (forecast.savedSoFar.bytes === 0) {
    input.stdout(`No savings recorded this ${period} yet.`);
    return 0;
  }

  const proj = formatDollarsSaved(forecast.projectedEnd.dollars);
  const saved = formatDollarsSaved(forecast.savedSoFar.dollars);
  const daysLeft = Math.round(forecast.daysLeft);
  let headline = `On pace to save ~${proj} this ${period} (est.) · ${saved} saved so far · ${daysLeft} days left`;
  if (pace) {
    const goalStr =
      goal?.kind === "dollars" ? formatDollarsSaved(goal.amount) : `${goal?.amount} tokens`;
    const pct = Math.round(pace.pctOfGoalProjected * 100);
    headline += ` — ${pct}% of your ${goalStr} ${goalSource === "stored" ? "stored budget" : "goal"} (${pace.onTrack ? "on track" : "behind"})`;
  }
  input.stdout(headline);
  input.stdout("");
  input.stdout(`saved so far   ${saved} (${forecast.savedSoFar.tokens} tokens)`);
  input.stdout(`daily rate     ${formatDollarsSaved(forecast.dailyRate.dollars)} / day`);
  input.stdout(`projected end  ${proj} (${Math.round(forecast.projectedEnd.tokens)} tokens)`);
  return 0;
}

export const savingsForecastCommand = defineCommand({
  meta: {
    name: "forecast",
    description: "Project this period's savings + pace vs a goal (Mega Saver Pro).",
  },
  args: {
    goal: {
      type: "string",
      description: "Savings goal: <tokens> or $<dollars> (e.g. 5000000 or $15).",
    },
    period: { type: "string", description: "month | week (default: month)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const period = typeof args.period === "string" ? args.period : undefined;
    const code = await runSavingsForecast({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      ...(period === "month" || period === "week" ? { period } : {}),
      ...(typeof args.goal === "string" ? { goal: args.goal } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
