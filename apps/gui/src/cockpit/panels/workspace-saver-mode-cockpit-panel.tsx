import { WorkspaceSaverModePanel } from "../../views/cockpit/workspace-saver-mode-panel.js";
import type { CockpitPanelProps } from "../panel.js";

export function WorkspaceSaverModeCockpitPanel({ dir, id, cwd }: CockpitPanelProps): JSX.Element {
  return <WorkspaceSaverModePanel dir={dir} id={id} cwd={cwd} />;
}
