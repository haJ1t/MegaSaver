import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type WorkspaceSaverStatus,
  fetchWorkspaceSaver,
  setWorkspaceSaver,
} from "../../lib/claude-sessions-client.js";

const MODES = ["aggressive", "balanced", "safe"] as const;

export function WorkspaceSaverModePanel({
  dir,
  id,
}: {
  dir: string;
  id: string;
}): JSX.Element {
  const [status, setStatus] = useState<WorkspaceSaverStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [actionError, setActionError] = useState<BridgeError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setStatus(await fetchWorkspaceSaver(dir, id));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [dir, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (enabled: boolean, mode: WorkspaceSaverStatus["mode"]) => {
      setBusy(true);
      setActionError(null);
      try {
        setStatus(await setWorkspaceSaver(dir, id, { enabled, mode }));
      } catch (err) {
        setActionError(err as BridgeError);
      } finally {
        setBusy(false);
      }
    },
    [dir, id],
  );

  return (
    <section
      aria-label="Workspace token saver panel"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Saver Mode</h2>
      <p className="text-xs text-text-muted">
        Activation is workspace-wide: it writes the Mega Saver block into this folder's CLAUDE.md
        and applies to every Claude session in the same directory.
      </p>
      {state === "loading" && <LoadingState label="Loading saver mode…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && status && (
        <>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy}
              onChange={(e) => void apply(e.target.checked, status.mode)}
            />
            Saver Mode {status.enabled ? "on" : "off"}
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            Mode
            <select
              aria-label="Compression budget"
              value={status.mode}
              disabled={busy}
              onChange={(e) =>
                void apply(status.enabled, e.target.value as WorkspaceSaverStatus["mode"])
              }
              className="rounded-md border border-border bg-surface-elevated px-2 py-1"
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-md border border-border bg-surface-elevated">
              CLAUDE.md block: {status.blockPresent ? "present" : "absent"}
            </span>
            <span className="px-2 py-1 rounded-md border border-border bg-surface-elevated">
              MCP bridge: {status.mcpInstalled ? "installed" : "not installed"}
            </span>
          </div>
          {actionError && (
            <p className="text-xs text-danger">Could not update Saver Mode — try again.</p>
          )}
          {status.enabled && !status.mcpInstalled && (
            <p className="text-xs text-danger">
              MCP bridge is not installed for Claude Code. Install it from Agent setup — Saver Mode
              has no effect until the proxy tools are available.
            </p>
          )}
        </>
      )}
    </section>
  );
}
