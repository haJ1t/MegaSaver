import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import { type WorkspaceIndexStatus, fetchWorkspaceIndex } from "../../lib/workspaces-client.js";

export function WorkspaceIndexPanel({ workspaceKey }: { workspaceKey: string }): JSX.Element {
  const [status, setStatus] = useState<WorkspaceIndexStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setStatus(await fetchWorkspaceIndex(workspaceKey));
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
    <section aria-label="Workspace index" className="flex flex-col gap-3 p-4">
      <h3 className="text-sm text-text-muted uppercase tracking-widest">Index</h3>
      {state === "loading" && <LoadingState label="Loading index status…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && status && !status.indexed && (
        <p className="text-xs text-text-muted">No index yet. Build it: mega index build</p>
      )}
      {state === "ready" && status?.indexed && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(status.byType)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([type, n]) => (
              <span
                key={type}
                className="px-2 py-1 rounded-md border border-border bg-surface-elevated text-xs"
              >
                {type}: {n}
              </span>
            ))}
        </div>
      )}
    </section>
  );
}
