import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type OverlaySessionTokenSaverStats,
  type WorkspaceTokenSaverTotals,
  fetchSessionTokenSaverStats,
  fetchWorkspaceTokenSaverStats,
} from "../../lib/claude-sessions-client.js";

const POLL_MS = 2_000;

type SaverTotals = { bytesSavedTotal: number; savingRatio: number };

export function SessionSaverStats({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [stats, setStats] = useState<OverlaySessionTokenSaverStats | null>(null);
  const [workspaceTotals, setWorkspaceTotals] = useState<WorkspaceTokenSaverTotals | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    let latest = nonce;
    const tick = (silent: boolean): void => {
      const requestId = ++latest;
      if (!silent) {
        setState("loading");
        setError(null);
      }
      Promise.all([fetchSessionTokenSaverStats(dir, id), fetchWorkspaceTokenSaverStats(dir, id)])
        .then(([session, workspace]) => {
          if (live && requestId === latest) {
            setStats(session);
            setWorkspaceTotals(workspace);
            setState("ready");
          }
        })
        .catch((err: unknown) => {
          if (live && requestId === latest && !silent) {
            setError(err as BridgeError);
            setState("error");
          }
        });
    };
    tick(false);
    const t = setInterval(() => tick(true), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [dir, id, nonce]);

  // Per-session summaries scatter across rotated liveSessionIds, so the
  // per-session read can be null while the workspace has real savings; fall
  // back to the workspace-wide total (ported from #221).
  const totals: SaverTotals | null = stats ?? workspaceTotals;
  const isWorkspace = stats === null && workspaceTotals !== null;

  return (
    <section aria-label="Session savings" className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-widest text-text-muted">Savings</h3>
      {state === "loading" && <LoadingState label="Loading savings…" />}
      {state === "error" && error && (
        <ErrorState error={error} onRetry={() => setNonce((n) => n + 1)} />
      )}
      {state === "ready" &&
        (totals === null ? (
          <p className="text-sm text-text-muted">No token-saver activity in this workspace yet.</p>
        ) : (
          <dl className="text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-text-secondary">
                Tokens saved
                {isWorkspace && workspaceTotals && (
                  <span className="font-normal text-text-muted">
                    {" "}
                    (workspace · {workspaceTotals.sessionsCount} sessions)
                  </span>
                )}
              </dt>
              <dd className="tabular-nums font-medium text-accent">
                {savedTokens(totals).toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-text-secondary">Reduction</dt>
              <dd className="tabular-nums text-text-primary">{savedPct(totals)}%</dd>
            </div>
          </dl>
        ))}
    </section>
  );
}

function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}
function savedTokens(s: SaverTotals): number {
  return tokensFromBytes(s.bytesSavedTotal);
}
function savedPct(s: SaverTotals): number {
  return Math.round(s.savingRatio * 100);
}
