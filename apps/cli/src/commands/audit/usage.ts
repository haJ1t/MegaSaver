import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type ProxyUsageSavings,
  proxyUsageSavings,
  sumBytesSavedSince,
  tokensFromBytes,
} from "@megasaver/core";
import { type ProxyUsageEvent, readProxyUsage } from "@megasaver/llm-proxy";
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

export type WorkspaceSavings = {
  totalTokens: number;
  byWorkspace: Record<string, number>;
};

// F33 numerator: sum savings across EVERY workspace under stats/ so the
// ratio's scope matches the global usage denominator (the proxy meters all
// workspaces on this machine). Per-workspace token values are kept for the
// breakdown; totalTokens sums them (ceil-per-workspace rounding is noise).
function readAllWorkspacesSavedTokensSince(storeRoot: string, sinceMs: number): WorkspaceSavings {
  let names: string[] = [];
  try {
    names = readdirSync(join(storeRoot, "stats"));
  } catch {
    return { totalTokens: 0, byWorkspace: {} };
  }
  const byWorkspace: Record<string, number> = {};
  let totalTokens = 0;
  for (const workspaceKey of names) {
    const saved = readWorkspaceSavedTokensSince(storeRoot, workspaceKey, sinceMs);
    if (saved > 0) byWorkspace[workspaceKey] = saved;
    totalTokens += saved;
  }
  return { totalTokens, byWorkspace };
}

export function renderUsageReport(m: ProxyUsageSavings, skippedLines: number): string {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const n = (x: number): string => x.toLocaleString("en-US");
  const skipNote = skippedLines > 0 ? ["", `⚠ ${skippedLines} unreadable usage lines skipped`] : [];
  const meteringNote = "note: the proxy meters usage; savings come from the saver hook/tools.";
  if (m.proxyCalls === 0) {
    return [
      "No proxy usage recorded yet.",
      "Run `mega proxy start`, point your agent at it (export ANTHROPIC_BASE_URL),",
      "then this reports savings against your real Claude token usage.",
      ...skipNote,
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
      meteringNote,
      ...skipNote,
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
    meteringNote,
    ...skipNote,
  ].join("\n");
}

export type RunAuditUsageInput = {
  storeRoot: string;
  cwd: string;
  json: boolean;
  // Injectable for tests; default to the real on-disk readers. `readSavedAll`
  // returns saved TOKENS within [sinceMs, now] summed across all workspaces.
  readUsage?: typeof readProxyUsage;
  readSavedAll?: (storeRoot: string, sinceMs: number) => WorkspaceSavings;
};

export async function runAuditUsage(input: RunAuditUsageInput): Promise<string> {
  const readUsage = input.readUsage ?? readProxyUsage;
  const readSavedAll = input.readSavedAll ?? readAllWorkspacesSavedTokensSince;

  let usage: readonly ProxyUsageEvent[] = [];
  let skippedLines = 0;
  try {
    const read = await readUsage({ storeRoot: input.storeRoot });
    usage = read.events;
    skippedLines = read.skippedLines;
  } catch {
    // No proxy-usage log yet.
  }

  // Window the numerator to the proxy's metering period (earliest usage ts).
  const sinceMs = usage.reduce((min, u) => {
    const t = Date.parse(u.ts);
    return Number.isFinite(t) ? Math.min(min, t) : min;
  }, Number.POSITIVE_INFINITY);

  let saved: WorkspaceSavings = { totalTokens: 0, byWorkspace: {} };
  if (usage.length > 0) {
    try {
      saved = readSavedAll(input.storeRoot, sinceMs);
    } catch {
      // Store not initialized — report against zero savings.
    }
  }

  // F33 scope matching: rows carrying a workspaceKey divide against that
  // workspace's savings ONLY; keyless rows form the global bucket, divided
  // against savings not attributed to any keyed workspace. Today the writer
  // never stamps workspaceKey (single global listener, no per-request
  // attribution), so every row is keyless and global/global is the — scope-
  // matched — comparison.
  const keyed = new Map<string, ProxyUsageEvent[]>();
  const keyless: ProxyUsageEvent[] = [];
  for (const u of usage) {
    if (u.workspaceKey === undefined) {
      keyless.push(u);
    } else {
      keyed.set(u.workspaceKey, [...(keyed.get(u.workspaceKey) ?? []), u]);
    }
  }
  const scoped: Record<string, ProxyUsageSavings> = {};
  let attributedTokens = 0;
  for (const [key, rows] of keyed) {
    const savedTokens = saved.byWorkspace[key] ?? 0;
    attributedTokens += savedTokens;
    scoped[key] = proxyUsageSavings({ savedTokens, usage: rows });
  }
  const globalSavings = proxyUsageSavings({
    savedTokens: saved.totalTokens - attributedTokens,
    usage: keyless,
  });

  if (input.json) {
    return JSON.stringify({
      ...globalSavings,
      skippedLines,
      savedByWorkspace: saved.byWorkspace,
      ...(keyed.size > 0 ? { scoped } : {}),
    });
  }

  const n = (x: number): string => x.toLocaleString("en-US");
  const lines: string[] = [];
  for (const [key, s] of Object.entries(scoped)) {
    const share = s.reliable
      ? ` (${(s.savedShareOfNewContext * 100).toFixed(1)}%)`
      : " (% suppressed: low coverage)";
    lines.push(
      `workspace ${key}: saved ~${n(s.savedTokens)} of ${n(s.newContextTokens)} new-context tokens${share}`,
    );
  }
  if (keyless.length > 0 || keyed.size === 0) {
    if (lines.length > 0) lines.push("");
    lines.push("scope: all workspaces (global)");
    lines.push(renderUsageReport(globalSavings, skippedLines));
  }
  const breakdown = Object.entries(saved.byWorkspace)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (breakdown.length > 0) {
    const current = encodeWorkspaceKey(input.cwd);
    lines.push("", "savings by workspace (usage is not attributed per workspace — no ratios):");
    for (const [key, tokens] of breakdown) {
      lines.push(`  ${key}  ~${n(tokens)} tokens${key === current ? " (this workspace)" : ""}`);
    }
  }
  return lines.join("\n");
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
