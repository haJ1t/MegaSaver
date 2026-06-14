import { WorkspaceSaverModePanel } from "../../views/cockpit/workspace-saver-mode-panel.js";
import type { CockpitPanelProps } from "../panel.js";

export function WorkspaceSaverModeCockpitPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  return <WorkspaceSaverModePanel dir={dir} id={id} />;
}
