import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { type ReadyTaskPlan, fetchTasks } from "../lib/api-client.js";

const STEP_STATUS_CLASS: Record<"completed" | "running" | "failed" | "pending", string> = {
  completed: "bg-ok/15 text-ok",
  running: "bg-accent/15 text-accent",
  failed: "bg-danger/15 text-danger",
  pending: "bg-surface-elevated text-text-muted",
};

export function TasksView({ projectId }: { projectId: string }): JSX.Element {
  const [plans, setPlans] = useState<ReadyTaskPlan[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setPlans(await fetchTasks(projectId));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-label="Tasks"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Task plans</h2>

      {state === "loading" && <LoadingState label="Loading task plans…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && plans.length === 0 && (
        <EmptyState
          title="No task plans yet."
          description="Create one from the terminal: mega task plan <project> --task … --step …"
        />
      )}
      {state === "ready" &&
        plans.map(({ plan, ready }) => {
          const readySet = new Set<string>(ready);
          return (
            <div
              key={plan.id}
              className="flex flex-col gap-2 p-3 rounded-md border border-border bg-surface-elevated"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary font-medium">{plan.task}</span>
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-accent/15 text-text-secondary">
                  {plan.status}
                </span>
              </div>
              <ol className="flex flex-col gap-1">
                {plan.steps.map((step) => (
                  <li key={step.id} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded ${STEP_STATUS_CLASS[step.status]}`}>
                      {step.status}
                    </span>
                    <span className="text-text-muted">{step.type}</span>
                    <span className="text-text-primary truncate">{step.title}</span>
                    {readySet.has(step.id) && (
                      <span className="ml-auto text-ok" aria-label="ready">
                        ready
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
    </section>
  );
}
