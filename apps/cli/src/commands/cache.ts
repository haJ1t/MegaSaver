// apps/cli/src/commands/cache.ts
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CacheSuffixRisk } from "@megasaver/connector-claude-code";
import { resolveClaudeCodeSettingsPath } from "@megasaver/connector-claude-code";
import { checkEntitlement } from "@megasaver/entitlement";
import {
  type ProxyUsageEvent,
  proxyUsageEventSchema,
  proxyUsageLogPath,
} from "@megasaver/llm-proxy";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

export const CACHE_UPSELL = `The prompt-cache doctor is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export const NO_USAGE_NOTE =
  "no proxy usage recorded — enable metering with `mega proxy` and route your agent through it";

// The sole forwarding route Mega Saver owns (mirrors the proxy supervisor's
// bind). The suffix audit compares Claude settings against exactly this URL —
// anything else is a foreign custom base URL.
export const OWNED_ROUTE_BASE_URL = "http://127.0.0.1:8787";

// Boundary parse (§8): the window drives date arithmetic downstream. Cap the
// upper bound — a pathological value would push `since` past the JS Date range,
// and new Date(sinceMs).toISOString() throws a RangeError. No real usage log
// spans 10 years.
export function parseDays(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

// Discriminated settings read (phases 3-4 contract §2): absent contributes no
// risk, unreadable/malformed contribute exactly their own closed risk, and ok
// is the only branch the classifier ever inspects.
export type ClaudeSettingsReadResult =
  | { kind: "ok"; settings: unknown }
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "malformed" };

export type SuffixAuditResult = {
  composition: {
    scope: "measured-global";
    status: "measured" | "no-usage";
    totalMeasuredTokens: number;
    cacheCreationShare: number | null;
    cacheReadShare: number | null;
    inputShare: number | null;
    outputShare: number | null;
  };
  settingsStatus: "ok" | "absent" | "unreadable" | "malformed";
  risks: CacheSuffixRisk[];
};

export type RunCacheInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  days?: string;
  json?: boolean;
  suffixAudit?: boolean;
  // Returns the raw usage.jsonl text, or null when the log does not exist.
  readUsageLog: (storeRoot: string) => string | null;
  // Read-only seam for the suffix audit; never called before the Pro gate and
  // never called at all when --suffix-audit is absent.
  readClaudeSettings?: () => ClaudeSettingsReadResult;
  // Mega Saver's owned forwarding route; both URL risks need it to exist.
  ownedRouteBaseUrl?: string;
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

export function defaultReadClaudeSettings(): ClaudeSettingsReadResult {
  let raw: string;
  try {
    raw = readFileSync(resolveClaudeCodeSettingsPath(), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { kind: "malformed" };
    return { kind: "ok", settings: parsed };
  } catch {
    return { kind: "malformed" };
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
  const events: ProxyUsageEvent[] = [];
  for (const line of raw === null ? [] : raw.split("\n")) {
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

  // Lazy import after the gate (never load the Pro compute on the free path);
  // the price const is re-exported here so the CLI never depends on @megasaver/stats
  // directly (forbidden edge — see apps/cli/test/dependency-graph.test.ts).
  const { cacheComposition, diagnoseCache, INPUT_PRICE_PER_MTOK_USD } = await import(
    "@megasaver/pro-analytics"
  );
  const report = diagnoseCache(events, {
    now: input.now(),
    ...(days === undefined ? {} : { days }),
  });

  let suffixAudit: SuffixAuditResult | undefined;
  if (input.suffixAudit === true) {
    const { auditClaudeCacheSuffix } = await import("@megasaver/connector-claude-code");
    const composition = cacheComposition({
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      cacheReadTokens: report.cacheReadTokens,
      cacheCreationTokens: report.cacheCreationTokens,
    });
    const read =
      input.readClaudeSettings === undefined
        ? { kind: "absent" as const }
        : input.readClaudeSettings();
    let risks: CacheSuffixRisk[];
    if (read.kind === "ok") {
      risks = auditClaudeCacheSuffix(read.settings, {
        ...(input.ownedRouteBaseUrl === undefined
          ? {}
          : { ownedRouteBaseUrl: input.ownedRouteBaseUrl }),
      });
    } else if (read.kind === "unreadable") {
      risks = [{ scope: "configuration-risk", code: "settings_unreadable" }];
    } else if (read.kind === "malformed") {
      risks = [{ scope: "configuration-risk", code: "settings_malformed" }];
    } else {
      risks = [];
    }
    suffixAudit = { composition, settingsStatus: read.kind, risks };
  }

  // --json is a stable contract: ALWAYS emit the report as JSON, including the
  // empty-window / no-log case (calls: 0). Printing the prose note on those
  // paths would break jq / JSON.parse consumers.
  if (input.json) {
    input.stdout(JSON.stringify(suffixAudit === undefined ? report : { ...report, suffixAudit }));
    return 0;
  }

  const writeShareLine =
    suffixAudit === undefined
      ? undefined
      : suffixAudit.composition.status === "no-usage"
        ? "cache write share: n/a (no measured global usage)"
        : `cache write share: ${Math.round((suffixAudit.composition.cacheCreationShare ?? 0) * 100)}% (measured global usage)`;
  const printSuffixRisks = () => {
    if (suffixAudit === undefined) return;
    if (suffixAudit.risks.length === 0) return;
    input.stdout("configuration risks:");
    for (const risk of suffixAudit.risks) {
      input.stdout(`  - ${risk.code}`);
    }
  };

  if (report.calls === 0 && suffixAudit === undefined) {
    input.stdout(NO_USAGE_NOTE);
    return 0;
  }

  if (report.calls > 0) {
    const pct = `${Math.round(report.hitRate * 100)}%`;
    input.stdout(`Prompt-cache doctor — last ${report.windowDays} days`);
    input.stdout(
      `calls ${report.calls} · conversations ${report.conversations} · cache hit rate ${pct}`,
    );
    if (report.findings.length === 0) {
      input.stdout(`cache healthy — hit rate ${pct}, nothing burned`);
    } else {
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
      input.stdout(
        "(conversation grouping is a counts-only heuristic; parallel sessions can blur it)",
      );
    }
  } else if (suffixAudit !== undefined) {
    input.stdout("no proxy usage recorded — suffix audit shows configuration risks only");
  }
  if (writeShareLine !== undefined) input.stdout(writeShareLine);
  printSuffixRisks();
  if (report.calls > 0) {
    input.stdout(
      `(est. at $${INPUT_PRICE_PER_MTOK_USD}/M input; cache write billed at 1.25x, cache read at 0.1x.)`,
    );
  }
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
    "suffix-audit": {
      type: "boolean",
      default: false,
      description:
        "Add measured cache-token composition and static Claude settings risks (read-only).",
    },
  },
  async run({ args }) {
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    const code = await runCache({
      storeRoot,
      now: () => Date.now(),
      ...(typeof args.days === "string" ? { days: args.days } : {}),
      json: !!args.json,
      suffixAudit: !!args["suffix-audit"],
      readUsageLog: defaultReadUsageLog,
      readClaudeSettings: defaultReadClaudeSettings,
      ownedRouteBaseUrl: OWNED_ROUTE_BASE_URL,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
