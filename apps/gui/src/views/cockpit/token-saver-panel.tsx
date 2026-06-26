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
        Tokens saved (this session)
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
      {state === "ready" &&
        (stats === null ? (
          <p className="text-xs text-text-muted">No proxy activity recorded for this session.</p>
        ) : (
          <TokensSavedTable stats={stats} />
        ))}
    </section>
  );
}

// The tokens Claude Code would have spent on raw tool output vs. what MegaSaver
// actually returned this session. tokensFromBytes mirrors @megasaver/stats
// honest-metrics (Math.ceil(bytes / 4)); replicated here so the node-coupled
// stats package is never pulled into the browser bundle.
function TokensSavedTable({ stats }: { stats: OverlaySessionTokenSaverStats }): JSX.Element {
  const would = tokensFromBytes(stats.rawBytesTotal);
  const used = tokensFromBytes(stats.returnedBytesTotal);
  const saved = Math.max(0, would - used);
  return (
    <table className="w-full text-xs border border-border rounded-md overflow-hidden">
      <caption className="sr-only">Tokens saved from the Claude Code budget this session</caption>
      <tbody>
        <Row label="Would have used" value={fmtTokens(would)} />
        <Row label="Actually used" value={fmtTokens(used)} />
        <Row label="Saved" value={fmtTokens(saved)} emphasis />
      </tbody>
    </table>
  );
}

function tokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

function fmtTokens(n: number): string {
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} tokens`;
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): JSX.Element {
  return (
    <tr className="border-t border-border first:border-t-0">
      <td
        className={`px-3 py-2 ${emphasis ? "text-text-primary font-semibold" : "text-text-muted"}`}
      >
        {label}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${emphasis ? "text-accent font-semibold" : "text-text-primary font-medium"}`}
      >
        {value}
      </td>
    </tr>
  );
}
