import { encodeWorkspaceKey } from "@megasaver/shared";
import { WorkspaceContextPanel } from "../../views/cockpit/workspace-context-panel.js";
import { WorkspaceIndexPanel } from "../../views/cockpit/workspace-index-panel.js";
import { WorkspacePermissionsPanel } from "../../views/cockpit/workspace-permissions-panel.js";
import { WorkspaceRulesPanel } from "../../views/cockpit/workspace-rules-panel.js";
import { WorkspaceToolsPanel } from "../../views/cockpit/workspace-tools-panel.js";
import type { CockpitPanelProps } from "../panel.js";

// Cockpit adapters: the workspace panels are keyed by workspaceKey, derived here
// from the selected session's cwd. The session's project model is never touched.
export function WorkspaceIndexCockpitPanel({ cwd }: CockpitPanelProps): JSX.Element {
  return <WorkspaceIndexPanel workspaceKey={encodeWorkspaceKey(cwd)} />;
}

export function WorkspaceContextCockpitPanel({ cwd }: CockpitPanelProps): JSX.Element {
  return <WorkspaceContextPanel workspaceKey={encodeWorkspaceKey(cwd)} />;
}

export function WorkspaceRulesCockpitPanel({ cwd }: CockpitPanelProps): JSX.Element {
  return <WorkspaceRulesPanel workspaceKey={encodeWorkspaceKey(cwd)} />;
}

export function WorkspaceToolsCockpitPanel({ cwd }: CockpitPanelProps): JSX.Element {
  return <WorkspaceToolsPanel workspaceKey={encodeWorkspaceKey(cwd)} />;
}

export function WorkspacePermissionsCockpitPanel({ cwd }: CockpitPanelProps): JSX.Element {
  return <WorkspacePermissionsPanel workspaceKey={encodeWorkspaceKey(cwd)} />;
}
