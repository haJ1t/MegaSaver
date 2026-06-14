import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import { type WorkspaceRankedRule, fetchWorkspaceRules } from "../../lib/workspaces-client.js";

export function WorkspaceRulesPanel({ workspaceKey }: { workspaceKey: string }): JSX.Element {
  const [rules, setRules] = useState<WorkspaceRankedRule[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setRules(await fetchWorkspaceRules(workspaceKey));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [workspaceKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="Workspace rules" className="flex flex-col gap-3 p-4">
      <h3 className="text-sm text-text-muted uppercase tracking-widest">Rules</h3>
      {state === "loading" && <LoadingState label="Loading rules…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && rules && rules.length === 0 && (
        <p className="text-xs text-text-muted">No rules yet.</p>
      )}
      {state === "ready" && rules && rules.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rules.map((r) => (
            <li
              key={r.rule.title}
              className="px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
            >
              <span className="text-text-primary font-medium">{r.rule.title}</span>
              <span className="text-text-muted ml-2">{r.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
