import { MemoryPanel } from "../../views/cockpit/memory-panel.js";
import { TasksPanel } from "../../views/cockpit/tasks-panel.js";
import { TokenSaverPanel } from "../../views/cockpit/token-saver-panel.js";
import type { CockpitPanelProps } from "../panel.js";

// Cockpit adapters: the session-scoped overlay panels are keyed by the live
// session's (dir, id). The bridge resolves the workspaceKey server-side; Claude's
// transcript is never written.
export function MemoryCockpitPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  return <MemoryPanel dir={dir} id={id} />;
}

export function TasksCockpitPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  return <TasksPanel dir={dir} id={id} />;
}

export function TokenSaverCockpitPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  return <TokenSaverPanel dir={dir} id={id} />;
}
