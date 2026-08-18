import {
  BUDGET_VARIANCE_MIN_SAMPLES,
  type StoredTokenBudgets,
  clearTokenBudgets,
  effectiveSessionBudget,
  foldMeasuredBurn,
  medianOf,
  readOverlayEvents,
  readTokenBudgets,
  tokenBudgetsPath,
  tokenBudgetsStatus,
  writeTokenBudgets,
} from "@megasaver/core";
import { readProxyUsage } from "@megasaver/llm-proxy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type BudgetIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type RunBudgetSetInput = BudgetIo & {
  storeRoot: string;
  cwd: string;
  tokens: string;
  task?: string | undefined;
  session?: string | undefined;
  json?: boolean | undefined;
};

export function runBudgetSet(input: RunBudgetSetInput): 0 | 1 {
  const trimmed = input.tokens.trim();
  if (trimmed.startsWith("$")) {
    input.stderr(
      "Error: Token budgets are measured in tokens, not dollars. For dollar-denominated savings goals, see 'mega savings budget'.",
    );
    return 1;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    input.stderr(`Error: Invalid token count '${input.tokens}': expected a positive integer.`);
    return 1;
  }

  const workspaceKey = encodeWorkspaceKey(input.cwd);
  const status = tokenBudgetsStatus(input.storeRoot, workspaceKey);
  if (status === "corrupt") {
    input.stderr(
      `Error: budgets file at ${tokenBudgetsPath(input.storeRoot, workspaceKey)} is corrupt. Run 'mega budget clear' to reset.`,
    );
    return 1;
  }

  const existing = readTokenBudgets(input.storeRoot, workspaceKey) ?? {
    version: 1,
    sessions: {},
    tasks: {},
    labels: {},
  };

  const budgets: StoredTokenBudgets = {
    version: 1,
    ...(existing.sessionDefault !== undefined ? { sessionDefault: existing.sessionDefault } : {}),
    sessions: { ...existing.sessions },
    tasks: { ...existing.tasks },
    labels: { ...existing.labels },
  };

  let scopeMsg = "";
  if (input.task !== undefined && input.session !== undefined) {
    budgets.tasks[input.task] = parsed;
    budgets.labels[input.session] = input.task;
    scopeMsg = `task '${input.task}' set to ${parsed} tokens and session '${input.session}' labeled '${input.task}'`;
  } else if (input.task !== undefined) {
    budgets.tasks[input.task] = parsed;
    scopeMsg = `task '${input.task}' set to ${parsed} tokens`;
  } else if (input.session !== undefined) {
    budgets.sessions[input.session] = parsed;
    scopeMsg = `session '${input.session}' set to ${parsed} tokens`;
  } else {
    budgets.sessionDefault = parsed;
    scopeMsg = `default session budget set to ${parsed} tokens`;
  }

  writeTokenBudgets(input.storeRoot, workspaceKey, budgets);

  if (input.json) {
    input.stdout(JSON.stringify({ ok: true, budgets }));
  } else {
    input.stdout(`Budget configured: ${scopeMsg}.`);
  }
  return 0;
}

export type RunBudgetStatusInput = BudgetIo & {
  storeRoot: string;
  cwd: string;
  session?: string | undefined;
  json?: boolean | undefined;
};

export async function runBudgetStatus(input: RunBudgetStatusInput): Promise<0 | 1> {
  const workspaceKey = encodeWorkspaceKey(input.cwd);
  const status = tokenBudgetsStatus(input.storeRoot, workspaceKey);
  if (status === "corrupt") {
    if (input.json) {
      input.stdout(JSON.stringify({ ok: false, status: "corrupt" }));
      return 1;
    }
    input.stderr(
      `Error: budgets file at ${tokenBudgetsPath(input.storeRoot, workspaceKey)} is corrupt. Run 'mega budget clear' to reset.`,
    );
    return 1;
  }

  const budgets = readTokenBudgets(input.storeRoot, workspaceKey);
  const store = { root: input.storeRoot };
  let proxyResult: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    skippedLines: number;
    eventCount: number;
  } | null = null;

  try {
    const proxyUsage = await readProxyUsage({ storeRoot: input.storeRoot });
    if (proxyUsage.events.length > 0 || proxyUsage.skippedLines > 0) {
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheCreationTokens = 0;
      for (const ev of proxyUsage.events) {
        inputTokens += ev.inputTokens;
        outputTokens += ev.outputTokens;
        cacheReadTokens += ev.cacheReadTokens;
        cacheCreationTokens += ev.cacheCreationTokens;
      }
      proxyResult = {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        skippedLines: proxyUsage.skippedLines,
        eventCount: proxyUsage.events.length,
      };
    }
  } catch {
    // Proxy usage reading failed / ignored
  }

  if (
    budgets === null ||
    (budgets.sessionDefault === undefined &&
      Object.keys(budgets.sessions).length === 0 &&
      Object.keys(budgets.tasks).length === 0)
  ) {
    if (input.json) {
      input.stdout(
        JSON.stringify({
          budgets: null,
          sessions: [],
          proxy: proxyResult,
        }),
      );
      return 0;
    }
    input.stdout("No token budget configured. Set one: `mega budget set 500000`");
    if (proxyResult !== null) {
      input.stdout("\nProxy usage (store-wide, not session-scoped (F33)):");
      input.stdout(
        `  Input: ${proxyResult.inputTokens}, Output: ${proxyResult.outputTokens}, Cache Read: ${proxyResult.cacheReadTokens}, Cache Create: ${proxyResult.cacheCreationTokens} (${proxyResult.eventCount} requests)`,
      );
    }
    return 0;
  }

  const sessionIds = new Set<string>();
  if (input.session !== undefined) {
    sessionIds.add(input.session);
  } else {
    for (const sid of Object.keys(budgets.sessions)) sessionIds.add(sid);
    for (const sid of Object.keys(budgets.labels)) sessionIds.add(sid);
  }

  type SessionStatusItem = {
    sessionId: string;
    taskLabel?: string | undefined;
    burnTokens: number;
    limitTokens?: number | undefined;
    measuredEvents: number;
    unmeasuredEvents: number;
    pct?: number | undefined;
    median?: number | null | undefined;
  };

  const sessionItems: SessionStatusItem[] = [];

  for (const sid of sessionIds) {
    const events = readOverlayEvents(store, workspaceKey, sid);
    const burn = foldMeasuredBurn(events);
    const eff = effectiveSessionBudget(budgets, sid);
    const label = budgets.labels[sid];
    const pct = eff !== null ? Math.round((burn.burnTokens / eff.limitTokens) * 100) : undefined;

    let median: number | null = null;
    if (label !== undefined) {
      const siblings = Object.entries(budgets.labels)
        .filter(([s, l]) => l === label && s !== sid)
        .slice(-20)
        .map(([s]) => foldMeasuredBurn(readOverlayEvents(store, workspaceKey, s)))
        .filter((b) => b.measuredEvents > 0)
        .map((b) => b.burnTokens);
      if (siblings.length >= BUDGET_VARIANCE_MIN_SAMPLES) {
        median = medianOf(siblings);
      }
    }

    sessionItems.push({
      sessionId: sid,
      ...(label !== undefined ? { taskLabel: label } : {}),
      burnTokens: burn.burnTokens,
      ...(eff !== null ? { limitTokens: eff.limitTokens } : {}),
      measuredEvents: burn.measuredEvents,
      unmeasuredEvents: burn.unmeasuredEvents,
      ...(pct !== undefined ? { pct } : {}),
      ...(median !== null ? { median } : {}),
    });
  }

  if (input.json) {
    input.stdout(
      JSON.stringify({
        budgets,
        sessions: sessionItems,
        proxy: proxyResult,
      }),
    );
    return 0;
  }

  input.stdout("Token Budgets:");
  if (budgets.sessionDefault !== undefined) {
    input.stdout(`  Default session budget: ${budgets.sessionDefault} tokens`);
  }
  for (const [task, limit] of Object.entries(budgets.tasks)) {
    const count = Object.values(budgets.labels).filter((l) => l === task).length;
    input.stdout(`  Task '${task}': ${limit} tokens (${count} labeled sessions)`);
  }

  if (sessionItems.length > 0) {
    input.stdout("\nSessions:");
    for (const item of sessionItems) {
      const totalEvents = item.measuredEvents + item.unmeasuredEvents;
      const cov = `coverage ${item.measuredEvents}/${totalEvents} events`;
      const lim = item.limitTokens !== undefined ? `/${item.limitTokens}` : "";
      const pctStr = item.pct !== undefined ? ` (${item.pct}%)` : "";
      const labelStr = item.taskLabel !== undefined ? ` [task: ${item.taskLabel}]` : "";
      let line = `  ${item.sessionId}${labelStr}: ${item.burnTokens}${lim} measured tokens${pctStr} — ${cov}`;
      if (item.median !== undefined && item.median !== null && item.median > 0) {
        const mult = (item.burnTokens / item.median).toFixed(1);
        line += ` (sibling median: ${item.median}, current is ${mult}x)`;
      }
      input.stdout(line);
    }
  }

  if (proxyResult !== null) {
    input.stdout("\nProxy usage (store-wide, not session-scoped (F33)):");
    input.stdout(
      `  Input: ${proxyResult.inputTokens}, Output: ${proxyResult.outputTokens}, Cache Read: ${proxyResult.cacheReadTokens}, Cache Create: ${proxyResult.cacheCreationTokens} (${proxyResult.eventCount} requests)`,
    );
  }

  return 0;
}

export type RunBudgetClearInput = BudgetIo & {
  storeRoot: string;
  cwd: string;
  json?: boolean | undefined;
};

export function runBudgetClear(input: RunBudgetClearInput): 0 | 1 {
  const workspaceKey = encodeWorkspaceKey(input.cwd);
  clearTokenBudgets(input.storeRoot, workspaceKey);
  if (input.json) {
    input.stdout(JSON.stringify({ ok: true, cleared: true }));
  } else {
    input.stdout(`Cleared token budgets for workspace ${workspaceKey}.`);
  }
  return 0;
}

const budgetSetCommand = defineCommand({
  meta: {
    name: "set",
    description:
      "Configure a token budget limit for a session, task, or workspace default (see 'mega savings budget' for savings goals).",
  },
  args: {
    tokens: {
      type: "positional",
      required: true,
      description: "Budget limit in tokens (positive integer).",
    },
    task: {
      type: "string",
      description: "Apply budget to a task label.",
    },
    session: {
      type: "string",
      description: "Apply budget to a specific session ID.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit structured JSON result.",
    },
    store: {
      type: "string",
      description: "Override store directory.",
    },
  },
  run({ args }) {
    const storeEnv = readStoreEnv(args.store);
    const storeRoot = resolveStorePath(storeEnv);
    const exitCode = runBudgetSet({
      storeRoot,
      cwd: process.cwd(),
      tokens: args.tokens,
      task: args.task,
      session: args.session,
      json: args.json ?? false,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  },
});

const budgetStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Display active token budgets, measured spend, and variance warnings.",
  },
  args: {
    session: {
      type: "string",
      description: "Filter status to a specific session ID.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit structured JSON result.",
    },
    store: {
      type: "string",
      description: "Override store directory.",
    },
  },
  async run({ args }) {
    const storeEnv = readStoreEnv(args.store);
    const storeRoot = resolveStorePath(storeEnv);
    const exitCode = await runBudgetStatus({
      storeRoot,
      cwd: process.cwd(),
      session: args.session,
      json: args.json ?? false,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  },
});

const budgetClearCommand = defineCommand({
  meta: {
    name: "clear",
    description: "Clear all token budgets for this workspace.",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Emit structured JSON result.",
    },
    store: {
      type: "string",
      description: "Override store directory.",
    },
  },
  run({ args }) {
    const storeEnv = readStoreEnv(args.store);
    const storeRoot = resolveStorePath(storeEnv);
    const exitCode = runBudgetClear({
      storeRoot,
      cwd: process.cwd(),
      json: args.json ?? false,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  },
});

export const budgetCommand = defineCommand({
  meta: {
    name: "budget",
    description: "Manage token budgets and circuit breaker thresholds (set, status, clear).",
  },
  subCommands: {
    set: budgetSetCommand,
    status: budgetStatusCommand,
    clear: budgetClearCommand,
  },
});
