import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type OverlaySessionTokenSaverStats,
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
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const fetchData = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setState("loading");
        setError(null);
      }
      try {
        const s = await fetchSessionTokenSaverStats(dir, id);
        setStats(s);
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
      className="flex flex-col gap-6 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm text-text-muted uppercase tracking-widest">Token saver</h2>
        <span className="inline-flex items-center gap-1 text-xs text-text-secondary normal-case tracking-normal">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
            aria-hidden="true"
          />
          live
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HookConnection />
        <SaverModeActivation dir={dir} id={id} />
        <DaemonStatusPanel />
      </div>

      {state === "loading" && <LoadingState label="Loading token-saver stats…" />}
      {state === "error" && error && (
        <ErrorState error={error} onRetry={() => void fetchData(false)} />
      )}
      {state === "ready" &&
        (stats === null ? (
          <p className="text-xs text-text-muted">No proxy activity recorded for this session.</p>
        ) : (
          <TokensSavedHero stats={stats} />
        ))}
    </section>
  );
}

function TokensSavedHero({ stats }: { stats: OverlaySessionTokenSaverStats }): JSX.Element {
  const would = tokensFromBytes(stats.rawBytesTotal);
  const used = tokensFromBytes(stats.returnedBytesTotal);
  const saved = Math.max(0, would - used);
  const pct = would === 0 ? 0 : Math.round((saved / would) * 100);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 flex flex-col justify-between gap-4 p-6 border border-border rounded-xl bg-surface-elevated/30">
        <div className="text-sm text-text-muted">Tokens saved this session</div>
        <div className="flex items-baseline gap-3">
          <div className="text-5xl font-semibold tracking-tight text-text-primary tabular-nums">
            {fmt(saved)}
          </div>
          <div className="text-lg font-medium text-ok">{pct}%</div>
        </div>
        <div className="text-xs text-text-muted">
          Based on raw tool output vs. compressed output.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <MiniMetric label="Would have used" value={`${fmt(would)} tokens`} />
        <MiniMetric label="Actually used" value={`${fmt(used)} tokens`} />
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col justify-center gap-1 px-4 py-3 border border-border rounded-xl bg-surface">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-base font-semibold text-text-primary tabular-nums">{value}</div>
    </div>
  );
}

function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
