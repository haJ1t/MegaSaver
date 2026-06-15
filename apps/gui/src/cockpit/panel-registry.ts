import type { CockpitPanel } from "./panel.js";
import {
  MemoryCockpitPanel,
  TasksCockpitPanel,
  TokenSaverCockpitPanel,
} from "./panels/session-overlay-panels.js";
import { TelemetryPanel } from "./panels/telemetry-panel.js";
import { TranscriptPanel } from "./panels/transcript-panel.js";
import {
  WorkspaceContextCockpitPanel,
  WorkspaceIndexCockpitPanel,
  WorkspacePermissionsCockpitPanel,
  WorkspaceRulesCockpitPanel,
  WorkspaceToolsCockpitPanel,
} from "./panels/workspace-panels.js";
export const COCKPIT_PANELS: readonly CockpitPanel[] = [
  { id: "transcript", label: "Transcript", scope: "session", component: TranscriptPanel },
  { id: "telemetry", label: "Telemetry", scope: "session", component: TelemetryPanel },
  { id: "memory", label: "Memory", scope: "session", component: MemoryCockpitPanel },
  { id: "tasks", label: "Tasks", scope: "session", component: TasksCockpitPanel },
  { id: "token-saver", label: "Token saver", scope: "session", component: TokenSaverCockpitPanel },
  { id: "ws-index", label: "Index", scope: "workspace", component: WorkspaceIndexCockpitPanel },
  {
    id: "ws-context",
    label: "Context",
    scope: "workspace",
    component: WorkspaceContextCockpitPanel,
  },
  { id: "ws-rules", label: "Rules", scope: "workspace", component: WorkspaceRulesCockpitPanel },
  { id: "ws-tools", label: "Tools", scope: "workspace", component: WorkspaceToolsCockpitPanel },
  {
    id: "ws-permissions",
    label: "Permissions",
    scope: "workspace",
    component: WorkspacePermissionsCockpitPanel,
  },
];

export function getPanel(id: string): CockpitPanel | undefined {
  return COCKPIT_PANELS.find((p) => p.id === id);
}
