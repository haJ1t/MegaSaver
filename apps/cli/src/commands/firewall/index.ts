// apps/cli/src/commands/firewall.ts
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { firewallEventSchema, firewallLogPath } from "@megasaver/context-gate";
import { checkEntitlement } from "@megasaver/entitlement";
import type { FirewallEventInput } from "@megasaver/pro-analytics";
import { defineCommand, runCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { PRO_ANALYTICS_URL } from "../savings/index.js";
import { firewallAllowCommand } from "./allow.js";
import { firewallRefreshCommand } from "./refresh.js";
import { firewallStatusCommand } from "./status.js";

export const FIREWALL_UPSELL = `The context firewall audit is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export const NO_EVENTS_NOTE =
  "no firewall events recorded — either nothing was blocked or Mega Saver Mode is not routing this workspace";

const FOOTER =
  "note: the firewall guards the Mega Saver ingress surface (proxy tools + hooks); native agent reads bypass it";

// Boundary parse (§8): window drives date arithmetic downstream; the 3650 cap
// keeps `since` inside the JS Date range (cache-doctor lesson).
export function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

export type RunFirewallInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  days?: string;
  json?: boolean;
  readFirewallLog: (storeRoot: string) => string | null;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function defaultReadFirewallLog(storeRoot: string): string | null {
  try {
    return readFileSync(firewallLogPath(storeRoot), "utf8");
  } catch {
    return null;
  }
}

export async function runFirewall(input: RunFirewallInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(FIREWALL_UPSELL);
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
  // Package-firewall kinds are filtered HERE so pro-analytics' closed
  // FirewallEventInput union stays untouched and the audit totals keep their
  // pre-package meaning. TS does not narrow through KINDS.includes(e.kind) —
  // the explicit 3-way check plus the locally-typed array is the narrowing
  // that compiles (type-only import: no runtime cost on the free path).
  const events: FirewallEventInput[] = [];
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
      events.push({ ...event, kind: event.kind });
    }
  }

  // Lazy import after the gate: never load the Pro compute on the free path.
  const { diagnoseFirewall } = await import("@megasaver/pro-analytics");
  const report = diagnoseFirewall(events, {
    now: input.now(),
    ...(days === undefined ? {} : { days }),
  });

  // --json is a stable contract: ALWAYS JSON, including the empty/no-log case.
  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (report.events === 0) {
    input.stdout(NO_EVENTS_NOTE);
    return 0;
  }

  input.stdout(`Context firewall — last ${report.windowDays} days`);
  input.stdout(`events ${report.events}`);
  if (report.blockedReads.length > 0) {
    input.stdout("");
    input.stdout("blocked reads:");
    for (const b of report.blockedReads) {
      input.stdout(`  ${b.sourcePath} · ${b.count}x`);
    }
  }
  if (report.redactedByDetector.length > 0) {
    input.stdout("");
    input.stdout("redacted:");
    for (const r of report.redactedByDetector) {
      input.stdout(`  ${r.detector} · ${r.count}x`);
    }
  }
  if (report.observedEmails > 0) {
    input.stdout("");
    input.stdout(`observed (not redacted): ${report.observedEmails} email(s)`);
  }
  if (report.advice.length > 0) {
    input.stdout("");
    for (const a of report.advice) {
      input.stdout(`fix: ${a}`);
    }
  }
  input.stdout("");
  input.stdout(FOOTER);
  return 0;
}

export type RunFirewallAirlockListInput = {
  storeRoot: string;
  sessionId: string;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runFirewallAirlockList(input: RunFirewallAirlockListInput): Promise<0 | 1> {
  let rules: unknown[] = [];
  try {
    const { readRules } = await import("@megasaver/core");
    rules = await readRules(input.storeRoot, input.sessionId);
  } catch {
    rules = [];
  }
  if (input.json) {
    input.stdout(JSON.stringify(rules));
    return 0;
  }
  if (rules.length === 0) {
    input.stdout("no airlock rules");
    return 0;
  }
  for (const r of rules as { forbiddenPattern: string; reason: string }[]) {
    input.stdout(`${r.forbiddenPattern} \u2014 ${r.reason}`);
  }
  return 0;
}

export type RunFirewallAirlockClearInput = {
  storeRoot: string;
  sessionId: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runFirewallAirlockClear(input: RunFirewallAirlockClearInput): Promise<0 | 1> {
  try {
    const { clearRules } = await import("@megasaver/core");
    await clearRules(input.storeRoot, input.sessionId);
  } catch {}
  input.stdout("airlock cleared");
  return 0;
}

const firewallAirlockListCommand = defineCommand({
  meta: { name: "list", description: "List active airlock rules for a session (--json for JSON)." },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON array." },
    session: { type: "string", description: "Session id.", required: false },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const sessionId = typeof args.session === "string" ? args.session : "default";
    const code = await runFirewallAirlockList({
      storeRoot,
      sessionId,
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const firewallAirlockClearCommand = defineCommand({
  meta: { name: "clear", description: "Clear all airlock rules for a session." },
  args: {
    session: { type: "string", description: "Session id.", required: false },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const sessionId = typeof args.session === "string" ? args.session : "default";
    const code = await runFirewallAirlockClear({
      storeRoot,
      sessionId,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const firewallAirlockCommand = defineCommand({
  meta: { name: "airlock", description: "Manage transient airlock negative rules (list/clear)." },
  subCommands: {
    list: firewallAirlockListCommand,
    clear: firewallAirlockClearCommand,
  },
});

export const firewallCommand = defineCommand({
  meta: {
    name: "firewall",
    description:
      "Audit the context firewall — blocked secret reads, redactions, and PII observations (Mega Saver Pro). Free subcommands: status, refresh <names>, allow <name>, airlock list|clear.",
  },
  args: {
    days: { type: "string", description: "Window in days (default 7, max 3650)." },
    json: { type: "boolean", default: false, description: "Emit the FirewallReport as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args, rawArgs }) {
    // Explicit positional dispatch — NOT citty subCommands (spec Decision 7 +
    // architect B1): with a subCommands block declared, citty resolves the
    // FIRST non-dash token as a subcommand name before the parent run, so
    // `mega firewall --days 7` threw E_UNKNOWN_COMMAND on "7" (shipped
    // defect, empirically verified) and any new verb would too. Removing the
    // block and folding airlock into the same dispatch REPAIRS --days.
    const verbIndex = rawArgs.findIndex((a: string) => !a.startsWith("-"));
    const verb = verbIndex >= 0 ? rawArgs[verbIndex] : undefined;
    if (verb === "status" || verb === "refresh" || verb === "allow" || verb === "airlock") {
      const sliced = rawArgs.slice(verbIndex + 1);
      const sub = {
        status: firewallStatusCommand,
        refresh: firewallRefreshCommand,
        allow: firewallAllowCommand,
        airlock: firewallAirlockCommand,
      }[verb];
      await runCommand(sub as Parameters<typeof runCommand>[0], { rawArgs: sliced });
      return;
    }
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runFirewall({
      storeRoot,
      now: () => Date.now(),
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      readFirewallLog: defaultReadFirewallLog,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
