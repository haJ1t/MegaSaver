import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import { type WorkspaceToolsResponse, fetchWorkspaceTools } from "../../lib/workspaces-client.js";

export function WorkspaceToolsPanel({ workspaceKey }: { workspaceKey: string }): JSX.Element {
  const [data, setData] = useState<WorkspaceToolsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setData(await fetchWorkspaceTools(workspaceKey));
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
    <section aria-label="Workspace tools" className="flex flex-col gap-3 p-4">
      <h3 className="text-sm text-text-muted uppercase tracking-widest">Tools</h3>
      {state === "loading" && <LoadingState label="Loading tools…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && data && (
        <>
          <p className="text-xs text-text-muted">{data.route.reason}</p>
          {data.tools.length === 0 && <p className="text-xs text-text-muted">No tools yet.</p>}
          {data.tools.length > 0 && (
            <ul className="flex flex-col gap-1">
              {data.tools.map((t) => (
                <li
                  key={t.id}
                  className="px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
                >
                  <span className="text-text-primary font-medium">{t.name}</span>
                  <span className="text-text-muted ml-2">{t.category}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
