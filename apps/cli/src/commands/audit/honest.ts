import {
  type HonestMetrics,
  aggregateHonestMetrics,
  observationsFromEvents,
  readOverlayEvents,
  readOverlaySummaryAnyWorkspace,
  recordedEventsFromLogs,
} from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { formatOverlaySaverCard } from "./shared.js";

const OVERLAY_FALLBACK_NOTE =
  "Note: token-weighted honest metrics need a registered/proxy session; overlay bytes are shown instead.";

export function renderHonestReport(m: HonestMetrics): string {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  return [
    `eligible reduction:        ${pct(m.eligibleReduction)} (token-weighted, eligible mediated context only)`,
    `eligible token fraction:   ${pct(m.eligibleTokenFraction)} of observed tokens`,
    `proxied token fraction:    ${pct(m.proxiedTokenFraction)} of observed tokens`,
    `passthrough token fraction:${pct(m.passthroughTokenFraction)} of observed tokens`,
    `mediated eligible fraction:${pct(m.mediatedEligibleFraction)} of eligible tokens`,
    `observed/eligible tokens:  ${m.rawTokensObserved} / ${m.rawTokensEligible}`,
    "",
    "Note: the reduction applies to eligible mediated context only; it does not",
    "imply whole-session savings unless the mediated eligible fraction is high.",
  ].join("\n");
}

export type RunHonestAuditInput = {
  liveSessionId: string;
  storeRoot: string;
  cwd: string;
  json: boolean;
};

export async function runHonestAudit(input: RunHonestAuditInput): Promise<string> {
  const workspaceKey = encodeWorkspaceKey(input.cwd);
  let overlayEvents: readonly { rawBytes: number; returnedBytes: number }[] = [];
  try {
    overlayEvents = readOverlayEvents({ root: input.storeRoot }, workspaceKey, input.liveSessionId);
  } catch {
    // Store not initialized or no events for this session — report zeros.
  }
  const recorded = recordedEventsFromLogs({
    overlayEvents,
    sessionEvents: [],
    nativeEligible: [],
  });
  const metrics = aggregateHonestMetrics(observationsFromEvents(recorded));
  if (metrics.rawTokensEligible === 0) {
    const overlay = readOverlaySummaryAnyWorkspace({ root: input.storeRoot }, input.liveSessionId);
    if (overlay) {
      if (input.json) return JSON.stringify(overlay.summary);
      return [
        ...formatOverlaySaverCard(overlay.summary, overlay.workspaceKey),
        OVERLAY_FALLBACK_NOTE,
      ].join("\n");
    }
  }
  return input.json ? JSON.stringify(metrics) : renderHonestReport(metrics);
}

export const auditHonestCommand = defineCommand({
  meta: {
    name: "honest",
    description: "Honest token-reduction metrics (token-weighted + eligibility fractions).",
  },
  args: {
    sessionId: { type: "positional", required: true, description: "Live session id." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const storeEnv = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    let storeRoot: string;
    try {
      storeRoot = resolveStorePath(storeEnv);
    } catch {
      // Store path unresolvable — return zeros rather than crashing.
      storeRoot = "";
    }
    const out = await runHonestAudit({
      liveSessionId: args.sessionId,
      storeRoot,
      cwd: process.cwd(),
      json: args.json ?? false,
    });
    process.stdout.write(out);
  },
});
