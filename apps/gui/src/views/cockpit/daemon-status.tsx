import { useCallback, useEffect, useState } from "react";
import {
  type DaemonStatus,
  fetchDaemonStatus,
  startDaemon,
  stopDaemon,
} from "../../lib/claude-sessions-client.js";

const POLL_MS = 2_000;

export function DaemonStatusPanel(): JSX.Element {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await fetchDaemonStatus());
    } catch {
      // keep last good status on a transient poll error
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const running = status?.running ?? false;

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      if (running) {
        await stopDaemon();
      } else {
        await startDaemon();
      }
      await load();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-text-primary">Context daemon</h3>
        <div className="flex items-center gap-2 text-xs">
          <span
            data-status={running ? "live" : "stopped"}
            className={[
              "inline-block w-1.5 h-1.5 rounded-full",
              running ? "bg-ok" : "bg-text-muted",
            ].join(" ")}
            aria-hidden="true"
          />
          <span className="text-text-secondary">
            {running ? `live · ${status?.url ?? ""}` : "not running"}
          </span>
          {running && status?.sessions !== undefined && status.sessions > 0 && (
            <span className="text-text-muted">&nbsp;· {status.sessions} sessions</span>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="px-3 py-1.5 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80 disabled:opacity-50 transition-colors"
      >
        {busy ? "..." : running ? "Stop Daemon" : "Start Daemon"}
      </button>
    </section>
  );
}
