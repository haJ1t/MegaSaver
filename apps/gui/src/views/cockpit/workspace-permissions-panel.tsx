import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type WorkspacePermissionsResponse,
  fetchWorkspacePermissions,
} from "../../lib/workspaces-client.js";

export function WorkspacePermissionsPanel({
  workspaceKey,
}: {
  workspaceKey: string;
}): JSX.Element {
  const [data, setData] = useState<WorkspacePermissionsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setData(await fetchWorkspacePermissions(workspaceKey));
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
    <section aria-label="Workspace permissions" className="flex flex-col gap-3 p-4">
      <h3 className="text-sm text-text-muted uppercase tracking-widest">Permissions</h3>
      {state === "loading" && <LoadingState label="Loading permissions…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && data && (
        <p className="text-xs text-text-secondary">
          {data.loaded
            ? "Policy loaded from .megasaver/permissions.yaml"
            : "No project permissions file."}
        </p>
      )}
    </section>
  );
}
