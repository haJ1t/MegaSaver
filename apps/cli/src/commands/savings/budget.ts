// apps/cli/src/commands/savings/budget.ts
import type { KeyObject } from "node:crypto";
import {
  type StoredBudget,
  budgetPath,
  budgetStatus,
  clearBudget,
  readBudget,
  writeBudget,
} from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { parseGoal } from "./forecast.js";
import { PRO_ANALYTICS_UPSELL } from "./shared.js";

// The persistent budget is a Pro surface end to end (user decision 2026-07-09):
// even set/show/clear gate first, though they run no Pro compute.
type GateInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function entitled(input: GateInput): boolean {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(PRO_ANALYTICS_UPSELL);
    return false;
  }
  return true;
}

function formatGoalAmount(kind: "tokens" | "dollars", amount: number): string {
  return kind === "dollars" ? `$${amount}` : `${amount} tokens`;
}

export type RunBudgetSetInput = GateInput & { value: string; period?: string; json?: boolean };

export function runBudgetSet(input: RunBudgetSetInput): 0 | 1 {
  if (!entitled(input)) return 0;
  const goal = parseGoal(input.value);
  if (goal === null) {
    input.stderr(
      `Invalid budget ${input.value}: expected a positive number of tokens or $dollars.`,
    );
    return 1;
  }
  const period = input.period ?? "month";
  if (period !== "month" && period !== "week") {
    input.stderr(`Invalid --period ${period}: expected month or week.`);
    return 1;
  }
  const budget: StoredBudget = { version: 1, period, kind: goal.kind, amount: goal.amount };
  writeBudget(input.storeRoot, budget);
  if (input.json) {
    input.stdout(JSON.stringify({ budget }));
    return 0;
  }
  input.stdout(`Budget set: save ${formatGoalAmount(goal.kind, goal.amount)} per ${period}.`);
  return 0;
}

export type RunBudgetShowInput = GateInput & { json?: boolean };

export function runBudgetShow(input: RunBudgetShowInput): 0 | 1 {
  if (!entitled(input)) return 0;
  const status = budgetStatus(input.storeRoot);
  if (status === "corrupt") {
    if (input.json) {
      input.stdout(JSON.stringify({ status, budget: null }));
      return 1;
    }
    input.stderr(
      `budget.json is corrupt at ${budgetPath(input.storeRoot)} — run \`mega savings budget clear\`.`,
    );
    return 1;
  }
  const budget = status === "ok" ? readBudget(input.storeRoot) : null;
  if (input.json) {
    input.stdout(JSON.stringify({ status, budget }));
    return 0;
  }
  if (budget === null) {
    input.stdout("No budget set. Set one: mega savings budget set $20 --period month");
    return 0;
  }
  input.stdout(
    `Budget: save ${formatGoalAmount(budget.kind, budget.amount)} per ${budget.period}.`,
  );
  return 0;
}

export type RunBudgetClearInput = GateInput & { json?: boolean };

export function runBudgetClear(input: RunBudgetClearInput): 0 | 1 {
  if (!entitled(input)) return 0;
  clearBudget(input.storeRoot);
  if (input.json) {
    input.stdout(JSON.stringify({ cleared: true }));
    return 0;
  }
  input.stdout("Budget cleared.");
  return 0;
}

const COMMON_ARGS = {
  json: { type: "boolean", default: false, description: "Emit JSON output." },
  store: { type: "string", description: "Override store directory." },
} as const;

function wire(args: Record<string, unknown>): Omit<GateInput, "stdout" | "stderr"> {
  return {
    storeRoot: resolveStorePath(
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      readStoreEnv(typeof args["store"] === "string" ? args["store"] : undefined),
    ),
    now: () => Date.now(),
  };
}

const io = {
  stdout: (line: string) => console.log(line),
  stderr: (line: string) => console.error(line),
};

export const savingsBudgetCommand = defineCommand({
  meta: {
    name: "budget",
    description: "Set / show / clear the persistent savings budget (Mega Saver Pro).",
  },
  subCommands: {
    set: defineCommand({
      meta: { name: "set", description: "Set the budget: <tokens> or $<dollars>." },
      args: {
        value: {
          type: "positional",
          required: true,
          description: "<tokens> or $<dollars> (e.g. 5000000 or $20).",
        },
        period: { type: "string", description: "month | week (default: month)." },
        ...COMMON_ARGS,
      },
      run({ args }) {
        const code = runBudgetSet({
          ...wire(args),
          ...io,
          // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          value: String(args["value"]),
          // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          ...(typeof args["period"] === "string" ? { period: args["period"] } : {}),
          // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          json: !!args["json"],
        });
        if (code !== 0) process.exitCode = code;
      },
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show the stored budget." },
      args: { ...COMMON_ARGS },
      run({ args }) {
        const code = runBudgetShow({ ...wire(args), ...io, json: !!args.json });
        if (code !== 0) process.exitCode = code;
      },
    }),
    clear: defineCommand({
      meta: { name: "clear", description: "Remove the stored budget." },
      args: { ...COMMON_ARGS },
      run({ args }) {
        const code = runBudgetClear({ ...wire(args), ...io, json: !!args.json });
        if (code !== 0) process.exitCode = code;
      },
    }),
  },
});
