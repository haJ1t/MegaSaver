import type { RankedRule } from "@megasaver/core";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { fetchRules } from "../lib/api-client.js";

const SEVERITY_CLASS: Record<"critical" | "warning" | "info", string> = {
  critical: "bg-danger/15 text-danger",
  warning: "bg-warn/15 text-warn",
  info: "bg-accent/15 text-text-secondary",
};

export function RulesView({ projectId }: { projectId: string }): JSX.Element {
  const [rules, setRules] = useState<RankedRule[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [task, setTask] = useState("");
  const [appliedTask, setAppliedTask] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const data = await fetchRules(projectId, appliedTask.trim() ? { task: appliedTask } : {});
      setRules(data);
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [projectId, appliedTask]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-label="Rules"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm text-text-muted uppercase tracking-widest">Rules (FORGE)</h2>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedTask(task);
          }}
        >
          <input
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Rank for a task…"
            aria-label="Task to rank rules for"
            className="px-2 py-1 text-xs bg-surface-elevated border border-border rounded-md text-text-primary w-56 focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          <button
            type="submit"
            className="px-3 py-1 text-xs rounded-md bg-accent text-accent-fg cursor-pointer hover:opacity-90"
          >
            Apply
          </button>
        </form>
      </div>

      {state === "loading" && <LoadingState label="Loading rules…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && rules.length === 0 && (
        <EmptyState
          title="No rules yet."
          description="Add rules from the terminal: mega rules add <project> --title … --rule … --severity …"
        />
      )}
      {state === "ready" && rules.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rules.map(({ rule, score, reason }) => (
            <li
              key={rule.id}
              className="flex flex-col gap-1 p-3 rounded-md border border-border bg-surface-elevated"
            >
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 text-xs rounded ${SEVERITY_CLASS[rule.severity]}`}>
                  {rule.severity}
                </span>
                <span className="text-sm text-text-primary font-medium">{rule.title}</span>
                <span className="ml-auto text-xs text-text-muted">score {score.toFixed(2)}</span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">{rule.rule}</p>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>{reason}</span>
                {rule.appliesTo.length > 0 && (
                  <span className="font-mono">· {rule.appliesTo.join(", ")}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
