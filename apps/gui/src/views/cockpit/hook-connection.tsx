import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type ClaudeHookStatus,
  connectClaudeHook,
  disconnectClaudeHook,
  fetchClaudeHookStatus,
} from "../../lib/claude-sessions-client.js";

const DISCONNECT_WARNING =
  "Disconnect the Mega Saver hook? This removes it for ALL Claude Code sessions on this machine.";

export function HookConnection(): JSX.Element {
  const [status, setStatus] = useState<ClaudeHookStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [actionError, setActionError] = useState<BridgeError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setStatus(await fetchClaudeHookStatus());
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (next: boolean) => {
    if (!next && !window.confirm(DISCONNECT_WARNING)) return;
    setBusy(true);
    setActionError(null);
    try {
      setStatus(next ? await connectClaudeHook() : await disconnectClaudeHook());
    } catch (err) {
      setActionError(err as BridgeError);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs text-text-muted uppercase tracking-widest">Saver hook</h3>
      <p className="text-xs text-text-muted">
        Connecting installs the Mega Saver hooks into Claude Code. This applies to all Claude Code
        sessions on this machine.
      </p>
      {state === "loading" && <LoadingState label="Loading hook status..." />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && status && (
        <>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={status.connected}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Saver hook {status.connected ? "connected" : "disconnected"}
          </label>
          {actionError && (
            <p className="text-xs text-danger">Could not update the hook — try again.</p>
          )}
        </>
      )}
    </section>
  );
}
