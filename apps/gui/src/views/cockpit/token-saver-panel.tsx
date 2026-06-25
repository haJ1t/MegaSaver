import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type OverlaySessionTokenSaverStats,
  type OverlayTokenSaverEvent,
  fetchSessionTokenSaverEvents,
  fetchSessionTokenSaverStats,
} from "../../lib/claude-sessions-client.js";
import { DaemonStatusPanel } from "./daemon-status.js";
import { HookConnection } from "./hook-connection.js";
import { SaverModeActivation } from "./saver-mode-activation.js";

// Stats are file-backed (the proxy writes them as it compresses), so a short
// poll is the live-update mechanism. Silent polls keep the last good data on a
// transient error rather than flashing the error state.
const POLL_MS = 2_000;

export function TokenSaverPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [stats, setStats] = useState<OverlaySessionTokenSaverStats | null>(null);
  const [events, setEvents] = useState<OverlayTokenSaverEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const fetchData = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setState("loading");
        setError(null);
      }
      try {
        const [s, e] = await Promise.all([
          fetchSessionTokenSaverStats(dir, id),
          fetchSessionTokenSaverEvents(dir, id),
        ]);
        setStats(s);
        setEvents(e);
        setState("ready");
      } catch (err) {
        if (!silent) {
          setError(err as BridgeError);
          setState("error");
        }
      }
    },
    [dir, id],
  );

  useEffect(() => {
    void fetchData(false);
    const timer = setInterval(() => void fetchData(true), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchData]);

  return (
    <section
      aria-label="Session token saver"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Token saver</h2>
      <HookConnection />
      <SaverModeActivation dir={dir} id={id} />
      {/* Conversation proxy (llm-proxy) is hidden: it routes via ANTHROPIC_BASE_URL,
          which Claude Desktop overrides, so it is dead in the cockpit's context.
          The context daemon (below) is the active token-saver here. The proxy code
          stays for CLI/Codex token metering — see ProxyActivation / @megasaver/llm-proxy. */}
      <DaemonStatusPanel />
      <h3 className="flex items-center gap-2 text-xs text-text-muted uppercase tracking-widest">
        Stats (this session)
        <span className="inline-flex items-center gap-1 normal-case tracking-normal text-text-secondary">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
            aria-hidden="true"
          />
          live
        </span>
      </h3>
      {state === "loading" && <LoadingState label="Loading token-saver stats…" />}
      {state === "error" && error && (
        <ErrorState error={error} onRetry={() => void fetchData(false)} />
      )}
      {state === "ready" && (
        <div className="flex flex-col gap-3">
          {stats === null ? (
            <p className="text-xs text-text-muted">No proxy activity recorded for this session.</p>
          ) : (
            <table className="w-full text-xs border border-border rounded-md overflow-hidden">
              <caption className="sr-only">Token-saver totals for this session</caption>
              <tbody>
                <SummaryRow label="Events" value={stats.eventsTotal} />
                <SummaryRow label="Raw bytes" value={fmtBytes(stats.rawBytesTotal)} />
                <SummaryRow label="Returned bytes" value={fmtBytes(stats.returnedBytesTotal)} />
                <SummaryRow label="Bytes saved" value={fmtBytes(stats.bytesSavedTotal)} />
                <SummaryRow
                  label="Saving ratio"
                  value={`${Math.round(stats.savingRatio * 100)}%`}
                />
                <SummaryRow label="Chunks stored" value={stats.chunksStoredTotal} />
                <SummaryRow label="Last save" value={fmtTimestamp(stats.updatedAt)} />
              </tbody>
            </table>
          )}
          {events.length > 0 && (
            <table className="w-full text-xs border border-border rounded-md">
              <caption className="sr-only">Per-event savings</caption>
              <thead>
                <tr className="text-text-muted text-left">
                  <th scope="col" className="px-3 py-2 font-medium">
                    when
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    source
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    label
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    raw
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    returned
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    saved
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-t border-border">
                    <td className="px-3 py-2 text-text-secondary tabular-nums whitespace-nowrap">
                      {fmtTimestamp(ev.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{ev.sourceKind}</td>
                    <td className="px-3 py-2 text-text-primary truncate max-w-[16rem]">
                      {ev.label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtBytes(ev.rawBytes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtBytes(ev.returnedBytes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                      {fmtBytes(ev.bytesSaved)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Math.round(ev.savingRatio * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className="px-3 py-2 text-text-muted">{label}</td>
      <td className="px-3 py-2 text-right text-text-primary font-medium tabular-nums">{value}</td>
    </tr>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Local YYYY-MM-DD HH:MM:SS (to the second). Built from Date local parts rather
// than toLocaleString so the output is stable across locales and testable. The
// value is display-only, so an unparseable input falls back to the raw string.
export function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
