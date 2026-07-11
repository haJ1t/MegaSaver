import { WorkspacePicker } from "../components/workspace-picker.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { DecisionTracePanel } from "./cockpit/decision-trace-panel.js";
import { MemoryGraphPanel } from "./cockpit/memory-graph-panel.js";
import { MemoryPanel } from "./cockpit/memory-panel.js";

export function MemoryPage({
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
    <div className="flex flex-col flex-1 min-h-0 gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Memory</h2>
        <WorkspacePicker options={options} activeKey={key} onChange={onWorkspaceChange} />
      </div>
      {active === null ? (
        <p className="text-sm text-text-muted">Select a workspace to view its memory.</p>
      ) : (
        <div
          data-testid="memory-workspace-layout"
          className="grid flex-1 min-h-0 grid-cols-1 gap-6 overflow-y-auto lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,2.15fr)]"
        >
          <div className="flex min-h-[24rem] min-w-0">
            <MemoryPanel dir={active.rep.dir} id={active.rep.id} />
          </div>
          <div className="flex min-h-[32rem] min-w-0 lg:col-start-2">
            <MemoryGraphPanel dir={active.rep.dir} id={active.rep.id} />
          </div>
          <div className="flex min-h-[32rem] min-w-0 lg:col-span-2">
            <DecisionTracePanel dir={active.rep.dir} id={active.rep.id} />
          </div>
        </div>
      )}
    </div>
  );
}
