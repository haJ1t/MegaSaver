// apps/cli/src/commands/cache.ts
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkEntitlement } from "@megasaver/entitlement";
import {
  type ProxyUsageEvent,
  proxyUsageEventSchema,
  proxyUsageLogPath,
} from "@megasaver/llm-proxy";
import { INPUT_PRICE_PER_MTOK_USD } from "@megasaver/stats";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

export const CACHE_UPSELL = `The prompt-cache doctor is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export const NO_USAGE_NOTE =
  "no proxy usage recorded — enable metering with `mega proxy` and route your agent through it";

// Boundary parse (§8): the window drives date arithmetic downstream.
export function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export type RunCacheInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  days?: string;
  json?: boolean;
  // Returns the raw usage.jsonl text, or null when the log does not exist.
  readUsageLog: (storeRoot: string) => string | null;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export function defaultReadUsageLog(storeRoot: string): string | null {
  try {
    return readFileSync(proxyUsageLogPath(storeRoot), "utf8");
  } catch {
    return null;
  }
}

export async function runCache(input: RunCacheInput): Promise<0 | 1> {
  // Gate FIRST: the Pro compute must never half-run for a free user.
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(CACHE_UPSELL);
    return 0;
  }

  let days: number | undefined;
  if (input.days !== undefined) {
    const parsed = parseDays(input.days);
    if (parsed === null) {
      input.stderr(`Invalid --days ${input.days}: expected a whole number of days ≥ 1.`);
      return 1;
    }
    days = parsed;
  }

  const raw = input.readUsageLog(input.storeRoot);
  if (raw === null) {
    input.stdout(NO_USAGE_NOTE);
    return 0;
  }

  const events: ProxyUsageEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmed);
    } catch {
      continue; // a corrupt tail from a crashed writer must not kill the report
    }
    const result = proxyUsageEventSchema.safeParse(parsedLine);
    if (result.success) events.push(result.data);
  }

  const { diagnoseCache } = await import("@megasaver/pro-analytics");
  const report = diagnoseCache(events, {
    now: input.now(),
    ...(days === undefined ? {} : { days }),
  });

  if (report.calls === 0) {
    input.stdout(NO_USAGE_NOTE);
    return 0;
  }

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  const pct = `${Math.round(report.hitRate * 100)}%`;
  input.stdout(`Prompt-cache doctor — last ${report.windowDays} days`);
  input.stdout(
    `calls ${report.calls} · conversations ${report.conversations} · cache hit rate ${pct}`,
  );
  if (report.findings.length === 0) {
    input.stdout(`cache healthy — hit rate ${pct}, nothing burned`);
    return 0;
  }
  if (report.reliable) {
    input.stdout(`$${report.burnedUsdTotal.toFixed(2)} burned on cache misses`);
  } else {
    input.stdout(
      `not enough data for a confident diagnosis (${report.calls} calls, ${report.conversations} conversations) — counts below are indicative only`,
    );
  }
  input.stdout("");
  for (const f of report.findings) {
    input.stdout(
      `${f.detector}  ${f.conversations} conversation(s) · ${f.occurrences} occurrence(s) · ${f.missedTokens} tokens re-paid · ~$${f.burnedUsd.toFixed(2)}`,
    );
    input.stdout(`  fix: ${f.advice}`);
  }
  input.stdout("");
  input.stdout("(conversation grouping is a counts-only heuristic; parallel sessions can blur it)");
  input.stdout(
    `(est. at $${INPUT_PRICE_PER_MTOK_USD}/M input; cache write billed at 1.25x, cache read at 0.1x.)`,
  );
  return 0;
}

export const cacheCommand = defineCommand({
  meta: {
    name: "cache",
    description:
      "Prompt-cache doctor — detect cache misses, the dollars they burned, and how to fix them (Mega Saver Pro).",
  },
  args: {
    days: { type: "string", description: "Window in days (default: 7)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runCache({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      readUsageLog: defaultReadUsageLog,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
