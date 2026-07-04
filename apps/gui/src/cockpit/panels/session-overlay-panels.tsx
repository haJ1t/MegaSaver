import { TasksPanel } from "../../views/cockpit/tasks-panel.js";
import type { CockpitPanelProps } from "../panel.js";

export function TasksCockpitPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  return <TasksPanel dir={dir} id={id} />;
}
