import { DecisionTracePanel } from "./decision-trace-panel.js";

export function DecisionTraceTab({ dir, id }: { dir: string; id: string }): JSX.Element {
  return (
    <div className="w-full flex flex-col gap-4 p-5 rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div>
          <h3 className="text-base font-semibold text-text-primary m-0">Decision Trace Engine</h3>
          <p className="text-xs text-text-muted mt-0.5 mb-0">
            Inspect causal reasoning chains, decision timelines, and prompt lineage.
          </p>
        </div>
      </div>
      <DecisionTracePanel dir={dir} id={id} />
    </div>
  );
}
