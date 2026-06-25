import { useCallback, useEffect, useState } from "react";
import type { BridgeError } from "../../components/states.js";
import {
  type ProxyStatus,
  fetchProxyStatus,
  restartClaudeThroughProxy,
  setProxy,
} from "../../lib/claude-sessions-client.js";

const POLL_MS = 2_000;

export function ProxyActivation(): JSX.Element {
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await fetchProxyStatus());
    } catch {
      // keep last good status on a transient poll error
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const toggle = useCallback(async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      setStatus(await setProxy(enabled));
    } catch (err) {
      setActionError((err as BridgeError).error ?? "Could not toggle the proxy");
    } finally {
      setBusy(false);
    }
  }, []);

  const running = status?.running ?? false;

  const restart = useCallback(async (): Promise<void> => {
    // Quitting the desktop app ends this conversation — confirm before doing it.
    if (!window.confirm("Quit and relaunch Claude? This ends the current conversation.")) return;
    setActionError(null);
    try {
      await restartClaudeThroughProxy();
    } catch (err) {
      setActionError((err as BridgeError).error ?? "Could not restart Claude");
    }
  }, []);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs text-text-muted uppercase tracking-widest">Conversation proxy</h3>
      <p className="text-xs text-text-muted">
        Opt-in local proxy that meters your conversation token usage. Turning it on auto-routes new
        claude sessions through it (no export needed).
      </p>
      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={running}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Proxy {running ? "on" : "off"}
      </label>
      <div className="flex items-center gap-2 text-xs">
        <span
          data-status={running ? "live" : "stopped"}
          className={`inline-block w-1.5 h-1.5 rounded-full ${running ? "bg-ok" : "bg-text-muted"}`}
          aria-hidden="true"
        />
        <span className="text-text-secondary">
          {running ? `live · ${status?.url ?? ""}` : "not running"}
        </span>
      </div>
      {running && (
        <output className="flex flex-col items-start gap-1.5 text-xs text-warn">
          A session already open keeps using the direct API. Restart claude to route a fresh session
          through the proxy.
          <button
            type="button"
            onClick={() => void restart()}
            className="border border-warn px-2 py-0.5 text-warn hover:bg-warn hover:text-warn-fg"
          >
            Restart claude
          </button>
        </output>
      )}
      {status?.error && (
        <p role="alert" className="text-xs text-danger">
          Proxy error: {status.error}
        </p>
      )}
      {actionError && <p className="text-xs text-danger">{actionError}</p>}
    </section>
  );
}
