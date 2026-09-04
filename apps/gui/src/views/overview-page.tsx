import {
  SAVINGS_FOOTNOTE,
  computeSavingsHeadline,
  formatDollarsSaved,
} from "@megasaver/stats/headline";
import { useEffect, useState } from "react";
import { fetchMcpStatus } from "../lib/api-client.js";
import {
  type AllWorkspaceTokenSaverTotals,
  type ClaudeSessionMeta,
  fetchAllWorkspaceTotals,
  fetchClaudeHookStatus,
  fetchClaudeSessions,
  fetchDaemonStatus,
  fetchProxyStatus,
} from "../lib/claude-sessions-client.js";
import { greeting } from "../lib/greeting.js";
import { countLive, isLive } from "../lib/session-liveness.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { fetchWorkspaceIndex } from "../lib/workspaces-client.js";
import type { ViewId } from "../view-id.js";

type Check = {
  label: string;
  detail: string;
  ok: boolean;
  fixLabel?: string;
  // Where the fix button goes. Carried on the check itself rather than derived
  // from the label, so renaming a row cannot silently misroute it.
  fixView?: ViewId;
};

// `fetchAllWorkspaceTotals` is an unvalidated cast over a bridge response, and
// this feeds the app's flagship $ figure. A wrong-shaped body (or `[]`, which
// is truthy) otherwise reaches computeSavingsHeadline and renders "$NaN".
// Better to show the honest "no savings recorded yet" empty state.
function isUsableTotals(t: AllWorkspaceTokenSaverTotals | null): boolean {
  return (
    t !== null &&
    typeof t === "object" &&
    Number.isFinite(t.bytesSavedTotal) &&
    Number.isFinite(t.savingRatio) &&
    Number.isFinite(t.sessionsCount) &&
    Number.isFinite(t.workspaceCount)
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

// U+2212 minus so a losing window renders "−1.0k", matching the CLI surfaces.
function compactSigned(n: number): string {
  return n < 0 ? `−${compact(-n)}` : compact(n);
}

export function OverviewPage({
  options,
  activeKey,
  onNavigate,
  onOpenSession,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onNavigate: (view: ViewId) => void;
  onOpenSession: (session: ClaudeSessionMeta) => void;
}): JSX.Element {
  const [totals, setTotals] = useState<AllWorkspaceTokenSaverTotals | null>(null);
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const tick = (): void => {
      void fetchAllWorkspaceTotals()
        .then((t) => live && setTotals(isUsableTotals(t) ? t : null))
        .catch(() => live && setTotals(null));
      void fetchClaudeSessions(200, 0)
        .then((s) => live && setSessions(Array.isArray(s) ? s : []))
        .catch(() => {});
      // Outside the .then: the clock must keep advancing during a bridge
      // outage, or the live-session count freezes at its last known value.
      if (live) setNowMs(Date.now());
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // Readiness is five independent probes; one failing route degrades its own
  // row rather than blanking the section.
  const active = options.find((o) => o.key === activeKey) ?? options[0];
  // Depend on identity-stable fields, not the object: deriveWorkspaceOptions
  // rebuilds `options` on every 4s poll, so `[active]` would re-fire all five
  // readiness probes continuously.
  const activeIndexKey = active?.key ?? null;
  const activeLabel = active?.label ?? null;
  useEffect(() => {
    let live = true;
    const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
    void Promise.all([
      settle(fetchClaudeHookStatus()),
      settle(fetchProxyStatus()),
      settle(fetchMcpStatus()),
      settle(fetchDaemonStatus()),
      activeIndexKey ? settle(fetchWorkspaceIndex(activeIndexKey)) : Promise.resolve(null),
    ]).then(([hook, proxy, mcp, daemon, index]) => {
      if (!live) return;
      // The bridge is a boundary: `mcp` may be non-null yet carry no agents
      // array. Optional-chaining `mcp?.agents` alone still throws on .filter.
      const agents = Array.isArray(mcp?.agents) ? mcp.agents : [];
      const installed = agents.filter((a) => a.mcpInstalled).map((a) => a.agentId);
      setChecks([
        {
          label: "Saver hook",
          detail: hook?.connected ? "connected for all sessions" : "not connected",
          ok: hook?.connected === true,
          fixLabel: "Connect",
          fixView: "token-saver",
        },
        {
          label: "Compression proxy",
          detail: proxy?.enabled ? `listening on ${proxy.url}` : "stopped",
          ok: proxy?.enabled === true,
          fixLabel: "Turn on",
          fixView: "token-saver",
        },
        {
          label: "MCP bridge",
          detail: installed.length ? `installed for ${installed.join(", ")}` : "not installed",
          ok: installed.length > 0,
          fixLabel: "Install",
          // MCP install/repair lives on Setup, not Token saver.
          fixView: "agent-setup",
        },
        {
          label: "Daemon",
          detail: daemon?.running ? "running" : "stopped",
          ok: daemon?.running === true,
        },
        {
          label: "Code index",
          detail: index?.indexed
            ? `${index.indexedFiles} files indexed${activeLabel ? ` in ${activeLabel}` : ""}`
            : `missing${activeLabel ? ` for ${activeLabel}` : ""} — savings will be smaller`,
          ok: index?.indexed === true,
          fixLabel: "Build index",
          fixView: "workspace",
        },
      ]);
    });
    return () => {
      live = false;
    };
  }, [activeIndexKey, activeLabel]);

  const headline = totals ? computeSavingsHeadline(totals) : null;
  const liveSessions = sessions.filter((s) => isLive(s, nowMs));
  const readyCount = checks?.filter((c) => c.ok).length ?? 0;
  const liveCount = countLive(sessions, nowMs);

  const ratioPct = headline ? `${Math.round(headline.savingRatio * 100)}%` : "—";

  return (
    <div className="max-w-[1024px] flex flex-col gap-6 px-5 py-7">
      <div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">{greeting(new Date(nowMs))}</h1>
        <p className="mt-1 mb-0 text-text-secondary">
          {liveCount > 0
            ? `${liveCount} session${liveCount === 1 ? "" : "s"} running right now.`
            : "No sessions running right now."}{" "}
          {/* Workspaces seen in the session list — NOT totals.workspaceCount,
              which only counts workspaces that have recorded savings. */}
          {options.length > 0
            ? `Tracking ${options.length} workspace${options.length === 1 ? "" : "s"}.`
            : ""}
        </p>
      </div>

      <div className="grid grid-cols-[8fr_5fr] gap-4 max-lg:grid-cols-1">
        <section className="px-6 py-5 rounded-xl border border-border bg-surface shadow-md">
          <h2 className="m-0 text-lg font-semibold">Estimated savings</h2>
          <p className="mt-0.5 mb-0 text-xs text-text-secondary">All time</p>
          {/* The ≈ and (est.) markers are not decoration: packages/stats
              requires every surfaced $ to read as an estimate so the CLI and
              GUI never imply more precision than the model has. */}
          <div className="flex items-baseline gap-2.5 mt-2.5" title={SAVINGS_FOOTNOTE}>
            <span className="font-serif text-display tracking-tight">
              {headline ? `≈${formatDollarsSaved(headline.dollarsSaved)}` : "—"}
            </span>
            {headline ? <span className="text-sm text-text-muted">(est.)</span> : null}
          </div>
          <p className="mt-2.5 mb-0 text-text-secondary">
            {headline && totals && totals.bytesSavedTotal > 0
              ? `≈${headline.contextWindowsReclaimed.toFixed(1)} context windows reclaimed across ${totals.workspaceCount} workspace${totals.workspaceCount === 1 ? "" : "s"}.`
              : "No savings recorded yet — turn the saver on to start."}
          </p>
          {/* S4-1: the $ above prices the net clamped at 0; the breakdown
              renders the SIGNED net so a window that re-fetched more than it
              saved reads as the loss it is, never a flattering zero. */}
          {headline && headline.tokensRefetched > 0 ? (
            <p className="mt-1 mb-0 text-xs text-text-muted tabular-nums">
              {`≈${compact(headline.grossTokensSaved)} tokens saved − ${compact(headline.tokensRefetched)} re-fetched + overhead = ${compactSigned(headline.netTokensSigned)} net`}
            </p>
          ) : null}
          <p className="mt-4 mb-0 pt-3.5 border-t border-line-soft text-xs text-text-muted">
            {SAVINGS_FOOTNOTE}
          </p>
        </section>

        <div className="flex flex-col gap-4">
          <section className="flex-1 px-5 py-4 rounded-xl border border-border bg-surface">
            <h3 className="m-0 text-sm font-semibold">Tokens saved</h3>
            <div className="mt-3 border-t border-line-soft pt-3">
              <div className="mt-1.5 font-mono text-2xl tracking-tight">
                {headline ? compact(headline.tokensSaved) : "—"}
              </div>
              <div className="mt-0.5 text-xs text-text-secondary">
                {totals ? `across ${totals.sessionsCount} sessions` : "no data yet"}
              </div>
            </div>
          </section>
          <section className="flex-1 px-5 py-4 rounded-xl border border-border bg-surface">
            <h3 className="m-0 text-sm font-semibold">Average reduction</h3>
            <div className="mt-3 border-t border-line-soft pt-3">
              <div className="mt-1.5 font-mono text-2xl tracking-tight">{ratioPct}</div>
              <div className="mt-2.5 h-1.5 rounded-sm bg-surface-elevated overflow-hidden">
                <span
                  className="block h-full rounded-sm bg-accent"
                  style={{ width: headline ? ratioPct : "0%" }}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-4 border-b border-line-soft">
          <div className="flex-1 min-w-0">
            <h2 className="m-0 text-lg font-semibold">System readiness</h2>
            <p className="mt-0.5 mb-0 text-xs text-text-secondary">
              Everything the saver needs to actually save you money.
            </p>
          </div>
          <span className="font-mono text-xs text-text-secondary">
            {checks === null ? "checking…" : `${readyCount} of 5 ready`}
          </span>
          <div className="w-[110px] h-1.5 rounded-sm bg-surface-elevated overflow-hidden">
            <span
              className="block h-full rounded-sm bg-ok transition-[width] duration-300"
              style={{ width: checks === null ? "0%" : `${readyCount * 20}%` }}
            />
          </div>
        </div>
        {(checks ?? []).map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-3 px-5 py-3 border-t border-line-soft first:border-t-0"
          >
            <span
              aria-hidden="true"
              className={`grid place-items-center w-[18px] h-[18px] rounded-full text-2xs ${
                c.ok ? "badge-status-live" : "badge-status-warn"
              }`}
            >
              {c.ok ? "✓" : "!"}
            </span>
            <span className="font-medium">{c.label}</span>
            <span className="text-xs text-text-secondary">{c.detail}</span>
            {!c.ok && c.fixLabel && c.fixView ? (
              <button
                type="button"
                onClick={() => onNavigate(c.fixView as ViewId)}
                className="ml-auto px-3 py-1 rounded-md border border-border bg-background text-xs font-medium cursor-pointer hover:bg-surface-elevated"
              >
                {c.fixLabel}
              </button>
            ) : null}
          </div>
        ))}
        {checks === null ? (
          <div className="px-5 py-3 text-sm text-text-muted">Checking…</div>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5">
          <h2 className="m-0 text-sm font-semibold">Live now</h2>
          <button
            type="button"
            onClick={() => onNavigate("sessions")}
            className="p-0 border-0 bg-transparent text-xs text-accent cursor-pointer hover:underline"
          >
            All sessions →
          </button>
        </div>
        {liveSessions.map((s) => (
          <button
            key={`${s.dir}/${s.id}`}
            type="button"
            onClick={() => onOpenSession(s)}
            className="flex items-center gap-3 w-full px-5 py-3 border-0 border-t border-line-soft bg-transparent text-left cursor-pointer hover:bg-surface-elevated"
          >
            <span aria-hidden="true" className="w-[7px] h-[7px] rounded-full bg-ok pulse-dot" />
            <span className="flex-1 min-w-0 truncate">{s.title}</span>
            <span className="font-mono text-xs text-text-muted">{s.projectLabel}</span>
          </button>
        ))}
        {liveSessions.length === 0 ? (
          <div className="px-5 pb-4 text-sm text-text-muted border-t border-line-soft pt-3">
            Nothing running. Start a Claude Code session and it appears here.
          </div>
        ) : null}
      </section>
    </div>
  );
}
