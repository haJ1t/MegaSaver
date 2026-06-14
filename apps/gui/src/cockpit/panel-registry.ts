import type { CockpitPanel } from "./panel.js";
import { TelemetryPanel } from "./panels/telemetry-panel.js";
import { TranscriptPanel } from "./panels/transcript-panel.js";

export const COCKPIT_PANELS: readonly CockpitPanel[] = [
  { id: "transcript", label: "Transcript", scope: "session", component: TranscriptPanel },
  { id: "telemetry", label: "Telemetry", scope: "session", component: TelemetryPanel },
];

export function getPanel(id: string): CockpitPanel | undefined {
  return COCKPIT_PANELS.find((p) => p.id === id);
}
