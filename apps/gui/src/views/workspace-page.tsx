import { WorkspacePicker } from "../components/workspace-picker.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { WorkspaceContextPanel } from "./cockpit/workspace-context-panel.js";
import { WorkspaceIndexPanel } from "./cockpit/workspace-index-panel.js";
import { WorkspacePermissionsPanel } from "./cockpit/workspace-permissions-panel.js";
import { WorkspaceRulesPanel } from "./cockpit/workspace-rules-panel.js";
import { WorkspaceToolsPanel } from "./cockpit/workspace-tools-panel.js";

export function WorkspacePage({
  options,
  activeKey,
  onWorkspaceChange,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onWorkspaceChange: (key: string) => void;
}): JSX.Element {
  const key = activeKey ?? options[0]?.key ?? null;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Workspace</h2>
        <WorkspacePicker options={options} activeKey={key} onChange={onWorkspaceChange} />
      </div>
      {key === null ? (
        <p className="text-sm text-text-muted">Select a workspace to inspect.</p>
      ) : (
        <div className="flex flex-col gap-6 overflow-y-auto min-h-0">
          <WorkspaceIndexPanel workspaceKey={key} />
          <WorkspaceContextPanel workspaceKey={key} />
          <WorkspaceRulesPanel workspaceKey={key} />
          <WorkspaceToolsPanel workspaceKey={key} />
          <WorkspacePermissionsPanel workspaceKey={key} />
        </div>
      )}
    </div>
  );
}
