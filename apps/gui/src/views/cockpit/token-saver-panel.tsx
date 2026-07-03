import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type ClaudeHookStatus,
  type DaemonStatus,
  type OverlaySessionTokenSaverStats,
  type WorkspaceSaverStatus,
  type WorkspaceTokenSaverTotals,
  fetchClaudeHookStatus,
  fetchDaemonStatus,
  fetchSessionTokenSaverStats,
  fetchWorkspaceSaver,
  fetchWorkspaceTokenSaverStats,
} from "../../lib/claude-sessions-client.js";
import { DaemonStatusPanel } from "./daemon-status.js";
import { HookConnection } from "./hook-connection.js";
import { SaverModeActivation } from "./saver-mode-activation.js";

const POLL_MS = 2_000;

export function TokenSaverPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [stats, setStats] = useState<OverlaySessionTokenSaverStats | null>(null);
  const [workspaceTotals, setWorkspaceTotals] = useState<WorkspaceTokenSaverTotals | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let live = true;
    let latest = refreshNonce;
    const tick = (silent: boolean): void => {
      const requestId = ++latest;
      if (!silent) {
        setState("loading");
        setError(null);
      }
      Promise.all([fetchSessionTokenSaverStats(dir, id), fetchWorkspaceTokenSaverStats(dir, id)])
        .then(([session, workspace]) => {
          if (!live || requestId !== latest) return;
          setStats(session);
          setWorkspaceTotals(workspace);
          setState("ready");
        })
        .catch((err: unknown) => {
          if (!live || requestId !== latest) return;
          if (!silent) {
            setError(err as BridgeError);
            setState("error");
          }
        });
    };
    tick(false);
    const timer = setInterval(() => tick(true), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [dir, id, refreshNonce]);

  const retry = (): void => setRefreshNonce((n) => n + 1);

  return (
    <section
      aria-label="Session token saver"
      className="flex flex-col gap-6 py-6 overflow-y-auto flex-1 min-h-0"
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
      {state === "error" && error && <ErrorState error={error} onRetry={retry} />}
      {state === "ready" && stats === null && workspaceTotals === null && (
        <p className="text-sm text-text-muted">No token-saver activity in this workspace yet.</p>
      )}
      {state === "ready" && stats === null && workspaceTotals !== null && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              <tr>
                <th
                  scope="row"
                  className="px-4 py-3 text-left font-medium text-text-secondary w-1/2"
                >
                  Tokens saved{" "}
                  <span className="font-normal text-text-muted">
                    (workspace total ({workspaceTotals.sessionsCount} sessions))
                  </span>
                </th>
                <td className="px-4 py-3 text-text-primary tabular-nums">
                  <TokenSavedValue stats={workspaceTotals} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {state === "ready" && stats !== null && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              <tr>
                <th
                  scope="row"
                  className="px-4 py-3 text-left font-medium text-text-secondary w-1/2"
                >
                  Tokens saved
                </th>
                <td className="px-4 py-3 text-text-primary tabular-nums">
                  <TokenSavedValue stats={stats} />
                </td>
              </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 text-left font-medium text-text-secondary">
                    Hook
                  </th>
                  <td className="px-4 py-3">
                    <HookStatusValue />
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 text-left font-medium text-text-secondary">
                    Saver
                  </th>
                  <td className="px-4 py-3">
                    <SaverStatusValue dir={dir} id={id} />
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 text-left font-medium text-text-secondary">
                    Daemon
                  </th>
                  <td className="px-4 py-3">
                    <DaemonStatusValue />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
      )}

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

function TokenSavedValue({
  stats,
}: {
  stats: Pick<OverlaySessionTokenSaverStats, "rawBytesTotal" | "returnedBytesTotal">;
}): JSX.Element {
  const would = tokensFromBytes(stats.rawBytesTotal);
  const used = tokensFromBytes(stats.returnedBytesTotal);
  const saved = Math.max(0, would - used);
  const pct = would === 0 ? 0 : Math.round((saved / would) * 100);
  return (
    <span className="font-medium">
      {saved.toLocaleString()}{" "}
      <span className="text-text-muted font-normal">({pct}% vs. raw output)</span>
    </span>
  );
}

function HookStatusValue(): JSX.Element {
  const [status, setStatus] = useState<ClaudeHookStatus | null>(null);
  useEffect(() => {
    void fetchClaudeHookStatus().then(setStatus);
  }, []);
  const connected = status?.connected ?? false;
  return (
    <StatusText tone={connected ? "ok" : "muted"}>
      {connected ? "Connected" : "Disconnected"}
    </StatusText>
  );
}

function SaverStatusValue({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [status, setStatus] = useState<WorkspaceSaverStatus | null>(null);
  useEffect(() => {
    void fetchWorkspaceSaver(dir, id).then(setStatus);
  }, [dir, id]);
  const enabled = status?.enabled ?? false;
  return <StatusText tone={enabled ? "active" : "muted"}>{enabled ? "Active" : "Off"}</StatusText>;
}

function DaemonStatusValue(): JSX.Element {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  useEffect(() => {
    void fetchDaemonStatus().then(setStatus);
  }, []);
  const running = status?.running ?? false;
  return <StatusText tone={running ? "ok" : "muted"}>{running ? "Live" : "Stopped"}</StatusText>;
}

function StatusText({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "ok" | "active" | "muted" | "warn" | "danger";
}): JSX.Element {
  const toneClass = {
    ok: "text-accent",
    active: "text-accent",
    muted: "text-text-muted",
    warn: "text-danger",
    danger: "text-danger",
  }[tone];
  return <span className={`font-medium ${toneClass}`}>{children}</span>;
}

function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}
