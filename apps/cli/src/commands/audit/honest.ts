import {
  type HonestMetrics,
  aggregateHonestMetrics,
  observationsFromEvents,
  recordedEventsFromLogs,
} from "@megasaver/core";
import { defineCommand } from "citty";
import { readStoreEnv } from "../../store.js";

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
    void readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    // A session-stats loader (readOverlayEvents) requires both workspaceKey and
    // liveSessionId. The overlay store is keyed by (workspaceKey, liveSessionId);
    // the workspaceKey is not available from the sessionId alone without a registry
    // lookup that maps liveSessionId → workspaceKey. That wiring lands in Plan 2c.
    // Until then, proxy-mediated overlay events are not counted.
    console.log("note: proxy-mediated overlay events not yet counted (wiring lands in Plan 2c)");
    const recorded = recordedEventsFromLogs({
      overlayEvents: [],
      sessionEvents: [],
      nativeEligible: [],
    });
    const metrics = aggregateHonestMetrics(observationsFromEvents(recorded));
    if (args.json) {
      process.stdout.write(JSON.stringify(metrics));
    } else {
      process.stdout.write(renderHonestReport(metrics));
    }
  },
});
