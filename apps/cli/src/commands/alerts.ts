// apps/cli/src/commands/alerts.ts
import type { KeyObject } from "node:crypto";
import { type FirewallEvent, firewallEventSchema } from "@megasaver/context-gate";
import { type StoredBudget, budgetStatus, readBudget } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import type { FirewallEventInput } from "@megasaver/pro-analytics";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { defaultReadFirewallLog } from "./firewall/index.js";
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
  // Package-firewall kinds filtered HERE (explicit narrowing + locally-typed
  // array — TS does not narrow through KINDS.includes) so the Pro firewall
  // spike axis keeps its pre-package meaning.
  const fwEvents: FirewallEventInput[] = [];
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
    if (!result.success) continue;
    const event = result.data;
    if (event.kind === "blocked-read" || event.kind === "redacted" || event.kind === "observed") {
      // The narrowed property must be re-materialized in a fresh literal —
      // TS narrows event.kind, not event (single-object control flow).
      fwEvents.push({ ...event, kind: event.kind });
    }
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
      "Anomaly alerts — traffic/source/ratio/firewall spikes + budget pace (Mega Saver Pro); --failures runs the free silent-failure monitor.",
  },
  args: {
    days: { type: "string", description: "Window in days (default 30, max 3650)." },
    failures: {
      type: "boolean",
      default: false,
      description: "Free mode: silent-failure monitor over the live overlay session.",
    },
    "live-session": {
      type: "string",
      description: "Overlay session id (default: newest by last event).",
    },
    window: {
      type: "string",
      description: "Failure window in minutes (1..1440, default 240).",
    },
    file: { type: "string", description: "Read referenced text from a file instead of stdin." },
    strict: {
      type: "boolean",
      default: false,
      description: "Exit 1 when any enabled detector has findings.",
    },
    "tool-errors": {
      type: "boolean",
      default: true,
      description: "Enable the tool-error detector.",
    },
    overflow: {
      type: "boolean",
      default: true,
      description: "Enable the context-overflow detector.",
    },
    partial: {
      type: "boolean",
      default: true,
      description: "Enable the partial-completion detector.",
    },
    hallucinated: {
      type: "boolean",
      default: true,
      description: "Enable the hallucinated-state detector.",
    },
    "enable-hook": {
      type: "boolean",
      default: false,
      description: "Opt in to the Stop-hook failure reminder (warn-only).",
    },
    "disable-hook": {
      type: "boolean",
      default: false,
      description: "Remove the Stop-hook failure reminder.",
    },
    settings: { type: "string", description: "Override Claude Code settings.json path." },
    json: { type: "boolean", default: false, description: "Emit the AlertsReport as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);

    // Hook toggles are independent of the report (Decision 7): opt-in/out the
    // Stop reminder without running the monitor.
    if (args["enable-hook"] || args["disable-hook"]) {
      if (args["enable-hook"] && args["disable-hook"]) {
        console.error("error: --enable-hook and --disable-hook are mutually exclusive");
        process.exitCode = 1;
        return;
      }
      const { failureScanHookCommand, runFailuresHookToggle, defaultFailureScanSettingsPath } =
        await import("./failures/hook-toggle.js");
      const code = runFailuresHookToggle({
        action: args["enable-hook"] ? "enable" : "disable",
        settingsPath:
          typeof args.settings === "string" ? args.settings : defaultFailureScanSettingsPath(),
        command: failureScanHookCommand(typeof args.store === "string" ? args.store : undefined),
        json: !!args.json,
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      });
      if (code !== 0) process.exitCode = code;
      return;
    }

    // The failures branch runs BEFORE the Pro entitlement gate: the
    // silent-failure monitor is free (spec Decision 1).
    if (args.failures) {
      const { runAlertsFailures } = await import("./failures/index.js");
      const code = await runAlertsFailures({
        storeRoot,
        cwd: process.cwd(),
        now: () => Date.now(),
        ...(typeof args.days === "string" ? { days: args.days } : {}),
        ...(typeof args["live-session"] === "string" ? { liveSession: args["live-session"] } : {}),
        ...(typeof args.window === "string" ? { window: args.window } : {}),
        ...(typeof args.file === "string" ? { file: args.file } : {}),
        stdinIsTty: process.stdin.isTTY === true,
        readStdin: readAllStdin,
        json: !!args.json,
        strict: !!args.strict,
        toolErrors: !!args["tool-errors"],
        overflow: !!args.overflow,
        partial: !!args.partial,
        hallucinated: !!args.hallucinated,
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      });
      if (code !== 0) process.exitCode = code;
      return;
    }

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

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
