// apps/cli/src/commands/firewall.ts
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { type FirewallEvent, firewallEventSchema, firewallLogPath } from "@megasaver/context-gate";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

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
  const events: FirewallEvent[] = [];
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
    if (result.success) events.push(result.data);
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

export const firewallCommand = defineCommand({
  meta: {
    name: "firewall",
    description:
      "Audit the context firewall — blocked secret reads, redactions, and PII observations (Mega Saver Pro).",
  },
  args: {
    days: { type: "string", description: "Window in days (default 7, max 3650)." },
    json: { type: "boolean", default: false, description: "Emit the FirewallReport as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
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
