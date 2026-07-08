// packages/pro-analytics/src/firewall-report.ts
// Pure analyzer over firewall ledger events (spec §Architecture/4). Structural
// input type — pro-analytics must not import context-gate (no new dep edges).

export interface FirewallEventInput {
  at: string;
  kind: "blocked-read" | "redacted" | "observed";
  detector: string;
  count: number;
  // `| undefined` (not just optional): callers pass zod-inferred events where
  // an absent field is `string | undefined`, which exactOptionalPropertyTypes
  // rejects against a plain `?: string`. The reducer already handles undefined.
  sourcePath?: string | undefined;
}

export interface FirewallReport {
  windowDays: number;
  events: number;
  blockedReads: Array<{ sourcePath: string; count: number }>;
  redactedByDetector: Array<{ detector: string; count: number }>;
  observedEmails: number;
  advice: string[];
}

export const FIREWALL_ADVICE = {
  blocked:
    "the agent attempted to read secret files — review the prompts/workflows that pointed it there",
  secrets: "secrets passed through tool output — rotate any recently pasted credentials",
  pii: "PII appeared in tool output — check what files/commands expose customer data",
} as const;

const PII_DETECTORS = new Set(["credit_card", "iban", "tr_national_id"]);
const TOP_BLOCKED = 10;
const DAY_MS = 86_400_000;

export function diagnoseFirewall(
  events: FirewallEventInput[],
  opts: { now: number; days?: number },
): FirewallReport {
  const windowDays = opts.days ?? 7;
  const sinceMs = opts.now - windowDays * DAY_MS;
  const inWindow = events.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= sinceMs && t <= opts.now;
  });

  const blockedMap = new Map<string, number>();
  const redactedMap = new Map<string, number>();
  let observedEmails = 0;
  for (const e of inWindow) {
    if (e.kind === "blocked-read") {
      const key = e.sourcePath ?? "(unknown)";
      blockedMap.set(key, (blockedMap.get(key) ?? 0) + e.count);
    } else if (e.kind === "redacted") {
      redactedMap.set(e.detector, (redactedMap.get(e.detector) ?? 0) + e.count);
    } else if (e.detector === "email") {
      observedEmails += e.count;
    }
  }

  const blockedReads = [...blockedMap]
    .map(([sourcePath, count]) => ({ sourcePath, count }))
    .sort((a, b) => b.count - a.count || a.sourcePath.localeCompare(b.sourcePath))
    .slice(0, TOP_BLOCKED);
  const redactedByDetector = [...redactedMap]
    .map(([detector, count]) => ({ detector, count }))
    .sort((a, b) => b.count - a.count || a.detector.localeCompare(b.detector));

  const advice: string[] = [];
  if (blockedReads.length > 0) advice.push(FIREWALL_ADVICE.blocked);
  if (redactedByDetector.some((r) => !PII_DETECTORS.has(r.detector))) {
    advice.push(FIREWALL_ADVICE.secrets);
  }
  if (redactedByDetector.some((r) => PII_DETECTORS.has(r.detector))) {
    advice.push(FIREWALL_ADVICE.pii);
  }

  return {
    windowDays,
    events: inWindow.length,
    blockedReads,
    redactedByDetector,
    observedEmails,
    advice,
  };
}
