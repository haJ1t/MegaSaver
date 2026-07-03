import { readHeartbeatView } from "@megasaver/context-gate";

export type SaverTelemetry = {
  lastSaverHookInvocationAt: string | null;
  lastSaverHookInvocationAgeMs: number | null;
  lastCompressionAt: string | null;
  lastCompressionAgeMs: number | null;
};

const EMPTY: SaverTelemetry = {
  lastSaverHookInvocationAt: null,
  lastSaverHookInvocationAgeMs: null,
  lastCompressionAt: null,
  lastCompressionAgeMs: null,
};

// The proxy status's saver liveness comes from the saver spec's heartbeat
// registry (cross-spec contract): `latest.ts` → invocation, `latestCompression.ts`
// → compression. Lives in the CLI/stats status-assembly layer, NOT in
// @megasaver/proxy-control, so that package stays agent- and saver-agnostic. A
// missing/unreadable registry degrades every field to null (the pre-saver-ship
// state) without turning proxy readiness red.
export function readSaverTelemetry(storeRoot: string, now: number): SaverTelemetry {
  let view: ReturnType<typeof readHeartbeatView>;
  try {
    view = readHeartbeatView(storeRoot, now);
  } catch {
    return EMPTY;
  }
  const age = (iso: string | undefined): number | null =>
    iso === undefined ? null : Math.max(0, now - Date.parse(iso));
  return {
    lastSaverHookInvocationAt: view.latest?.ts ?? null,
    lastSaverHookInvocationAgeMs: age(view.latest?.ts),
    lastCompressionAt: view.latestCompression?.ts ?? null,
    lastCompressionAgeMs: age(view.latestCompression?.ts),
  };
}
