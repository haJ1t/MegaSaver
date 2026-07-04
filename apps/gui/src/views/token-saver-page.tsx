import { WorkspacePicker } from "../components/workspace-picker.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { DaemonStatusPanel } from "./cockpit/daemon-status.js";
import { HookConnection } from "./cockpit/hook-connection.js";
import { ProxyActivation } from "./cockpit/proxy-activation.js";
import { SaverModeActivation } from "./cockpit/saver-mode-activation.js";

export function TokenSaverPage({
  options,
  activeKey,
  onWorkspaceChange,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onWorkspaceChange: (key: string) => void;
}): JSX.Element {
  const key = activeKey ?? options[0]?.key ?? null;
  const active = options.find((o) => o.key === key) ?? null;
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6 overflow-y-auto">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Token saver</h2>
        <WorkspacePicker options={options} activeKey={key} onChange={onWorkspaceChange} />
      </div>
      <HookConnection />
      <ProxyActivation />
      {active === null ? (
        <p className="text-sm text-text-muted">Select a workspace to configure saver mode.</p>
      ) : (
        <SaverModeActivation dir={active.rep.dir} id={active.rep.id} />
      )}
      <DaemonStatusPanel />
    </div>
  );
}
