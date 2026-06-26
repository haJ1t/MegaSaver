import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type ClaudeHookStatus,
  type DaemonStatus,
  type OverlaySessionTokenSaverStats,
  type WorkspaceSaverStatus,
  fetchClaudeHookStatus,
  fetchDaemonStatus,
  fetchSessionTokenSaverStats,
  fetchWorkspaceSaver,
} from "../../lib/claude-sessions-client.js";
import { DaemonStatusPanel } from "./daemon-status.js";
import { HookConnection } from "./hook-connection.js";
import { SaverModeActivation } from "./saver-mode-activation.js";

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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">Token saver</h2>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
            aria-hidden="true"
          />
          live
        </span>
      </div>

      {state === "loading" && <LoadingState label="Loading token-saver stats…" />}
      {state === "error" && error && (
        <ErrorState error={error} onRetry={() => void fetchData(false)} />
      )}
      {state === "ready" &&
        (stats === null ? (
          <p className="text-sm text-text-muted">No proxy activity recorded for this session.</p>
        ) : (
          <div className="bg-surface border border-border rounded-xl p-6">
            <HeroMetric stats={stats} />
            <div className="mt-4 flex flex-wrap gap-2">
              <HookBadge />
              <SaverBadge dir={dir} id={id} />
              <DaemonBadge />
            </div>
          </div>
        ))}

      <details className="group">
        <summary className="text-xs text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
          Advanced
        </summary>
        <div className="mt-4 flex flex-col gap-6">
          <HookConnection />
          <SaverModeActivation dir={dir} id={id} />
          <DaemonStatusPanel />
        </div>
      </details>
    </section>
  );
}

function HeroMetric({ stats }: { stats: OverlaySessionTokenSaverStats }): JSX.Element {
  const would = tokensFromBytes(stats.rawBytesTotal);
  const used = tokensFromBytes(stats.returnedBytesTotal);
  const saved = Math.max(0, would - used);
  const pct = would === 0 ? 0 : Math.round((saved / would) * 100);
  return (
    <div>
      <div className="text-4xl font-semibold tracking-tight text-text-primary tabular-nums">
        {saved.toLocaleString()}
      </div>
      <div className="text-sm text-text-secondary">tokens saved</div>
      <div className="mt-1 text-xs text-text-muted">
        {pct}% vs. raw output · {would.toLocaleString()} would-have-used
      </div>
    </div>
  );
}

function HookBadge(): JSX.Element {
  const [status, setStatus] = useState<ClaudeHookStatus | null>(null);
  useEffect(() => {
    void fetchClaudeHookStatus().then(setStatus);
  }, []);
  const connected = status?.connected ?? false;
  return (
    <StatusBadge tone={connected ? "ok" : "muted"}>
      {connected ? "Hook connected" : "Hook disconnected"}
    </StatusBadge>
  );
}

function SaverBadge({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [status, setStatus] = useState<WorkspaceSaverStatus | null>(null);
  useEffect(() => {
    void fetchWorkspaceSaver(dir, id).then(setStatus);
  }, [dir, id]);
  const enabled = status?.enabled ?? false;
  return (
    <StatusBadge tone={enabled ? "active" : "muted"}>
      {enabled ? "Saver active" : "Saver off"}
    </StatusBadge>
  );
}

function DaemonBadge(): JSX.Element {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  useEffect(() => {
    void fetchDaemonStatus().then(setStatus);
  }, []);
  const running = status?.running ?? false;
  return (
    <StatusBadge tone={running ? "ok" : "muted"}>
      {running ? "Daemon live" : "Daemon stopped"}
    </StatusBadge>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "ok" | "active" | "muted" | "warn" | "danger";
}): JSX.Element {
  const toneClass = {
    ok: "badge-status-live",
    active: "badge-status-active",
    muted: "badge-status-muted",
    warn: "badge-status-warn",
    danger: "badge-status-danger",
  }[tone];
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium uppercase tracking-wide ${toneClass}`}
    >
      {children}
    </span>
  );
}

function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}
