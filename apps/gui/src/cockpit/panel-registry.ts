import type { CockpitPanel, CockpitTabGroup } from "./panel.js";
import { TasksCockpitPanel } from "./panels/session-overlay-panels.js";
import { TelemetryPanel } from "./panels/telemetry-panel.js";
import { TranscriptPanel } from "./panels/transcript-panel.js";

export const COCKPIT_PANELS: readonly CockpitPanel[] = [
  { id: "transcript", label: "Transcript", scope: "session", component: TranscriptPanel },
  { id: "telemetry", label: "Telemetry", scope: "session", component: TelemetryPanel },
  { id: "tasks", label: "Tasks", scope: "session", component: TasksCockpitPanel },
];

export const COCKPIT_TAB_GROUPS: readonly CockpitTabGroup[] = [
  { id: "transcript", label: "Transcript", panelIds: ["transcript"] },
  { id: "telemetry", label: "Telemetry", panelIds: ["telemetry"] },
  { id: "tasks", label: "Tasks", panelIds: ["tasks"] },
];

export function getPanel(id: string): CockpitPanel | undefined {
  return COCKPIT_PANELS.find((p) => p.id === id);
}
