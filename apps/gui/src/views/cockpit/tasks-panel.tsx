import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import { type SessionTaskPlanView, fetchSessionTasks } from "../../lib/claude-sessions-client.js";

export function TasksPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [plans, setPlans] = useState<SessionTaskPlanView[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setPlans(await fetchSessionTasks(dir, id));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [dir, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-label="Session tasks"
      className="flex flex-col gap-3 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Tasks</h2>
      {state === "loading" && <LoadingState label="Loading tasks…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && plans && plans.length === 0 && (
        <p className="text-xs text-text-muted">No task plans yet.</p>
      )}
      {plans && plans.length > 0 && (
        <ul className="flex flex-col gap-2">
          {plans.map(({ plan, ready }) => (
            <li
              key={plan.id}
              className="flex flex-col gap-1 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-text-primary font-medium flex-1">{plan.task}</span>
                <span className="text-text-muted">{plan.status}</span>
                <span className="px-2 py-0.5 rounded-full bg-accent/15 text-text-primary">
                  {ready.length} ready
                </span>
              </div>
              <ul className="flex flex-col gap-0.5 pl-2">
                {plan.steps.map((step) => (
                  <li key={step.id} className="flex items-center gap-2 text-text-muted">
                    <span className="text-text-secondary">{step.type}</span>
                    <span className="flex-1">{step.title}</span>
                    <span>{step.status}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
