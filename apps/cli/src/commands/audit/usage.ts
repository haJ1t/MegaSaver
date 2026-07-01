import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type ProxyUsageSavings,
  proxyUsageSavings,
  sumBytesSavedSince,
  tokensFromBytes,
} from "@megasaver/core";
import { listProxyUsage } from "@megasaver/llm-proxy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

// Numerator: compression savings across this workspace's overlay event logs,
// windowed to `sinceMs` so it covers the same period as the proxy's usage. Each
// `<liveSessionId>.events.jsonl` line carries `createdAt` + `bytesSaved`; we read
// those two fields loosely (resilient to schema drift) and let the pure
// sumBytesSavedSince apply the time filter. Missing dir / bad lines → 0.
function readWorkspaceSavedTokensSince(
  storeRoot: string,
  workspaceKey: string,
  sinceMs: number,
): number {
  const dir = join(storeRoot, "stats", workspaceKey);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  const events: { createdAt: string; bytesSaved: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".events.jsonl")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let ev: unknown;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (
        typeof ev === "object" &&
        ev !== null &&
        typeof (ev as { createdAt?: unknown }).createdAt === "string" &&
        typeof (ev as { bytesSaved?: unknown }).bytesSaved === "number"
      ) {
        const e = ev as { createdAt: string; bytesSaved: number };
        events.push({ createdAt: e.createdAt, bytesSaved: e.bytesSaved });
      }
    }
  }
  return tokensFromBytes(sumBytesSavedSince(events, sinceMs));
}

export function renderUsageReport(m: ProxyUsageSavings): string {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const n = (x: number): string => x.toLocaleString("en-US");
  if (m.proxyCalls === 0) {
    return [
      "No proxy usage recorded yet.",
      "Run `mega proxy start`, point your agent at it (export ANTHROPIC_BASE_URL),",
      "then this reports savings against your real Claude token usage.",
    ].join("\n");
  }
  const rawLines = [
    `saved (tool output):       ~${n(m.savedTokens)} tokens (est, bytes/4)`,
    `real new context:           ${n(m.newContextTokens)} tokens (input + cache-creation)`,
    `real cache re-reads:        ${n(m.cacheReadTokens)} tokens`,
    `real output:                ${n(m.outputTokens)} tokens`,
    `proxy calls:                ${n(m.proxyCalls)}`,
  ];
  // Suppress the ratio when it can't be trusted: `saved > new context` means the
  // proxy captured only part of the workload (or a stray old usage row skewed the
  // window), which saturates the % toward 100% and would read as "saves 97% of my
  // Claude bill". Show only the raw counts and how to fix the coverage.
  if (!m.reliable) {
    return [
      ...rawLines,
      "",
      "% suppressed: not enough matched proxy coverage for a trustworthy ratio",
      "(tokens saved exceed the new context the proxy measured — the proxy saw only",
      "part of your traffic, so any % would overstate the saving). Route your agent",
      "through `mega proxy` for your whole workload, then re-run for a real figure.",
    ].join("\n");
  }
  return [
    ...rawLines,
    "",
    `saved of new context:       ${pct(m.savedShareOfNewContext)}   (saved / (saved + new context))`,
    `saved of total processed:   ${pct(m.savedShareOfTotalContext)}   (adds cache re-reads)`,
    "",
    "Scope: savings are windowed to the period since your first recorded proxy",
    "call, to match the usage denominator. One-shot estimate (a floor): a saved",
    "token also avoids cache re-reads on every later turn, so real impact is larger.",
  ].join("\n");
}

export type RunAuditUsageInput = {
  storeRoot: string;
  cwd: string;
  json: boolean;
  // Injectable for tests; default to the real on-disk readers. `readSaved`
  // returns saved TOKENS within [sinceMs, now].
  listUsage?: typeof listProxyUsage;
  readSaved?: (storeRoot: string, workspaceKey: string, sinceMs: number) => number;
};

export async function runAuditUsage(input: RunAuditUsageInput): Promise<string> {
  const workspaceKey = encodeWorkspaceKey(input.cwd);
  const readSaved = input.readSaved ?? readWorkspaceSavedTokensSince;
  const listUsage = input.listUsage ?? listProxyUsage;

  let usage: Awaited<ReturnType<typeof listProxyUsage>> = [];
  try {
    usage = await listUsage({ storeRoot: input.storeRoot });
  } catch {
    // No proxy-usage log yet.
  }

  // Window the numerator to the proxy's metering period (earliest usage ts).
  const sinceMs = usage.reduce((min, u) => {
    const t = Date.parse(u.ts);
    return Number.isFinite(t) ? Math.min(min, t) : min;
  }, Number.POSITIVE_INFINITY);

  let savedTokens = 0;
  if (usage.length > 0) {
    try {
      savedTokens = readSaved(input.storeRoot, workspaceKey, sinceMs);
    } catch {
      // Store not initialized — report against zero savings.
    }
  }

  const savings = proxyUsageSavings({ savedTokens, usage });
  return input.json ? JSON.stringify(savings) : renderUsageReport(savings);
}

export const auditUsageCommand = defineCommand({
  meta: {
    name: "usage",
    description: "Estimated savings vs your real total Claude usage (needs `mega proxy`).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const storeEnv = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    let storeRoot: string;
    try {
      storeRoot = resolveStorePath(storeEnv);
    } catch {
      storeRoot = "";
    }
    const out = await runAuditUsage({
      storeRoot,
      cwd: process.cwd(),
      json: args.json ?? false,
    });
    process.stdout.write(`${out}\n`);
  },
});
