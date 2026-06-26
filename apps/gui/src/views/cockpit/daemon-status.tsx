import { useCallback, useEffect, useState } from "react";
import { type DaemonStatus, fetchDaemonStatus } from "../../lib/claude-sessions-client.js";

const POLL_MS = 2_000;

// ponytail: status-only panel; daemon is lazily spawned by MCP/hook clients,
// not the GUI — add a start/stop control only if the GUI gains spawn authority.
export function DaemonStatusPanel(): JSX.Element {
  const [status, setStatus] = useState<DaemonStatus | null>(null);

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

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text-primary">Context daemon</h3>
      <div className="flex items-center gap-2 text-xs">
        <span
          data-status={running ? "live" : "stopped"}
          className={`inline-block w-1.5 h-1.5 rounded-full ${running ? "bg-ok" : "bg-text-muted"}`}
          aria-hidden="true"
        />
        <span className="text-text-secondary">
          {running ? `live · ${status?.url ?? ""}` : "not running"}
        </span>
        {running && status?.sessions !== undefined && status.sessions > 0 && (
          <span className="text-text-muted">&nbsp;· {status.sessions} sessions</span>
        )}
      </div>
    </section>
  );
}
