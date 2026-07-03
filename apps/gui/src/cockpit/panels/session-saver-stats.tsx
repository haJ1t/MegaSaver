import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type OverlaySessionTokenSaverStats,
  fetchSessionTokenSaverStats,
} from "../../lib/claude-sessions-client.js";

const POLL_MS = 2_000;

export function SessionSaverStats({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [stats, setStats] = useState<OverlaySessionTokenSaverStats | null>(null);
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
      fetchSessionTokenSaverStats(dir, id)
        .then((s) => {
          if (live && requestId === latest) {
            setStats(s);
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

  return (
    <section aria-label="Session savings" className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-widest text-text-muted">Savings</h3>
      {state === "loading" && <LoadingState label="Loading savings…" />}
      {state === "error" && error && (
        <ErrorState error={error} onRetry={() => setNonce((n) => n + 1)} />
      )}
      {state === "ready" &&
        (stats === null ? (
          <p className="text-sm text-text-muted">No proxy activity this session.</p>
        ) : (
          <dl className="text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-text-secondary">Tokens saved</dt>
              <dd className="tabular-nums font-medium text-accent">
                {savedTokens(stats).toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-text-secondary">Reduction</dt>
              <dd className="tabular-nums text-text-primary">{savedPct(stats)}%</dd>
            </div>
          </dl>
        ))}
    </section>
  );
}

function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}
function savedTokens(s: OverlaySessionTokenSaverStats): number {
  return Math.max(0, tokensFromBytes(s.rawBytesTotal) - tokensFromBytes(s.returnedBytesTotal));
}
function savedPct(s: OverlaySessionTokenSaverStats): number {
  const would = tokensFromBytes(s.rawBytesTotal);
  return would === 0 ? 0 : Math.round((savedTokens(s) / would) * 100);
}
