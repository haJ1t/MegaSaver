import type { WorkspaceOption } from "../lib/workspace-context.js";
import { DecisionTracePanel } from "./cockpit/decision-trace-panel.js";
import { MemoryGraphPanel } from "./cockpit/memory-graph-panel.js";
import { MemoryPanel } from "./cockpit/memory-panel.js";

export function MemoryPage({
  options,
  activeKey,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
}): JSX.Element {
  const key = activeKey ?? options[0]?.key ?? null;
  const active = options.find((o) => o.key === key) ?? null;
  return (
    <div className="max-w-[1180px] flex flex-col gap-4 px-5 py-7">
      <div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="mt-1 mb-0 text-text-secondary">
          What the agent remembers
          {active ? (
            <>
              {" "}
              about <span className="font-mono text-sm">{active.label}</span>
            </>
          ) : null}
          , and how it got there.
        </p>
      </div>
      {active === null ? (
        <p className="text-sm text-text-muted">Select a workspace to view its memory.</p>
      ) : (
        <div
          data-testid="memory-workspace-layout"
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,2.15fr)]"
        >
          <section className="flex min-h-[24rem] min-w-0 px-5 py-4 rounded-xl border border-border bg-surface">
            <MemoryPanel dir={active.rep.dir} id={active.rep.id} />
          </section>
          <section className="flex min-h-[32rem] min-w-0 px-5 py-4 rounded-xl border border-border bg-surface lg:col-start-2">
            <MemoryGraphPanel dir={active.rep.dir} id={active.rep.id} />
          </section>
          <section className="flex min-h-[32rem] min-w-0 px-5 py-4 rounded-xl border border-border bg-surface lg:col-span-2">
            <DecisionTracePanel dir={active.rep.dir} id={active.rep.id} />
          </section>
        </div>
      )}
    </div>
  );
}
