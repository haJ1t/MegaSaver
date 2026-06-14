import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type OverlaySessionTokenSaverStats,
  type OverlayTokenSaverEvent,
  fetchSessionTokenSaverEvents,
  fetchSessionTokenSaverStats,
} from "../../lib/claude-sessions-client.js";

export function TokenSaverPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [stats, setStats] = useState<OverlaySessionTokenSaverStats | null>(null);
  const [events, setEvents] = useState<OverlayTokenSaverEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const [s, e] = await Promise.all([
        fetchSessionTokenSaverStats(dir, id),
        fetchSessionTokenSaverEvents(dir, id),
      ]);
      setStats(s);
      setEvents(e);
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [dir, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-label="Session token saver"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Token saver</h2>
      <p className="text-xs text-text-muted">
        This tab shows recorded proxy savings. To turn Saver Mode on or off, use the workspace
        “Saver Mode” tab — activation is per-folder, not per-session.
      </p>
      {state === "loading" && <LoadingState label="Loading token-saver stats…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && (
        <>
          {stats === null ? (
            <p className="text-xs text-text-muted">No proxy activity recorded for this session.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Stat label="events" value={stats.eventsTotal} />
              <Stat label="raw bytes" value={stats.rawBytesTotal} />
              <Stat label="returned bytes" value={stats.returnedBytesTotal} />
              <Stat label="bytes saved" value={stats.bytesSavedTotal} />
              <Stat label="saving ratio" value={`${Math.round(stats.savingRatio * 100)}%`} />
              <Stat label="chunks stored" value={stats.chunksStoredTotal} />
            </div>
          )}
          {events.length > 0 && (
            <ul className="flex flex-col gap-1">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
                >
                  <span className="text-text-secondary">{ev.sourceKind}</span>
                  <span className="text-text-primary flex-1 truncate">{ev.label}</span>
                  <span className="text-text-muted tabular-nums">
                    {Math.round(ev.savingRatio * 100)}% saved
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="flex flex-col items-start px-3 py-2 rounded-md border border-border bg-surface-elevated min-w-[6rem]">
      <span className="text-sm text-text-primary font-medium tabular-nums">{value}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  );
}
