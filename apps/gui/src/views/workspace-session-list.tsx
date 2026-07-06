import {
  SAVINGS_FOOTNOTE,
  computeSavingsHeadline,
  formatDollarsSaved,
} from "@megasaver/stats/headline";
import { useEffect, useState } from "react";
import type { BridgeError } from "../components/states.js";
import { ErrorState, LoadingState } from "../components/states.js";
import {
  type AllWorkspaceTokenSaverTotals,
  type ClaudeSessionMeta,
  fetchAllWorkspaceTotals,
  fetchClaudeSessions,
} from "../lib/claude-sessions-client.js";
import { groupSessionsByCwd } from "../lib/workspace-grouping.js";
import { SavingsShareModal } from "./savings-share-modal.js";

const LIST_POLL_MS = 4000;
const LIVE_WINDOW_MS = 8000;

function relativeTime(mtimeMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - mtimeMs);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function shortModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

function sessionKey(s: ClaudeSessionMeta): string {
  return `${s.dir}/${s.id}`;
}

export function WorkspaceSessionList({
  onSelect,
}: {
  onSelect: (session: ClaudeSessionMeta) => void;
}): JSX.Element {
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<BridgeError | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [savingsTotals, setSavingsTotals] = useState<AllWorkspaceTokenSaverTotals | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const hasSavings = savingsTotals !== null && savingsTotals.bytesSavedTotal > 0;

  const groups = groupSessionsByCwd(sessions);
  const liveCount = sessions.filter((s) => nowMs - s.mtimeMs < LIVE_WINDOW_MS).length;

  const toggleGroup = (cwd: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  };

  const retryList = (): void => {
    setRefreshNonce((n) => n + 1);
  };

  useEffect(() => {
    let live = true;
    let latest = refreshNonce;
    const tick = (): void => {
      const requestId = ++latest;
      fetchClaudeSessions(50, 0)
        .then((list) => {
          if (!live || requestId !== latest) return;
          setSessions(list);
          setListState("ready");
        })
        .catch((err: unknown) => {
          if (!live || requestId !== latest) return;
          setListError(err as BridgeError);
          setListState("error");
        })
        .finally(() => {
          if (live && requestId === latest) setNowMs(Date.now());
        });
    };
    tick();
    const t = setInterval(tick, LIST_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [refreshNonce]);

  // Cumulative savings are informational, not load-bearing: a failed fetch must
  // not error the session list. On failure the strip falls back to the honest
  // empty copy rather than surfacing a scary error.
  useEffect(() => {
    let live = true;
    const load = (): void => {
      fetchAllWorkspaceTotals()
        .then((totals) => {
          if (live) setSavingsTotals(totals);
        })
        .catch(() => {
          if (live) setSavingsTotals(null);
        });
    };
    load();
    const t = setInterval(load, LIST_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (listState === "loading") return <LoadingState label="Loading Claude Code sessions…" />;
  if (listState === "error" && listError)
    return <ErrorState error={listError} onRetry={retryList} />;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <h2 className="text-xl font-semibold tracking-tight text-text-primary mb-4">Sessions</h2>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <SummaryCard label="Workspaces" value={groups.length} />
        <SummaryCard label="Sessions" value={sessions.length} />
        <SummaryCard label="Live" value={liveCount} />
      </div>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <SavingsHeadlineStrip totals={savingsTotals} />
        </div>
        {hasSavings && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="mb-6 shrink-0 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-text-primary hover:bg-surface-elevated cursor-pointer transition-colors"
          >
            Share
          </button>
        )}
      </div>
      {shareOpen && savingsTotals && (
        <SavingsShareModal
          totals={savingsTotals}
          windowLabel="all time"
          onClose={() => setShareOpen(false)}
        />
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-text-muted">
          No Claude Code sessions found in ~/.claude/projects.
        </p>
      ) : (
        <div
          data-testid="session-list-card"
          className="bg-surface border border-border rounded-xl overflow-hidden"
        >
          {groups.map((group, groupIndex) => {
            const expanded = !collapsed.has(group.cwd);
            return (
              <div key={group.cwd} className={groupIndex > 0 ? "border-t border-border" : ""}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.cwd)}
                  aria-expanded={expanded}
                  title={group.cwd}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-left cursor-pointer hover:bg-surface-elevated transition-colors"
                >
                  <span className="text-text-muted text-xs">{expanded ? "▾" : "▸"}</span>
                  <span className="truncate text-xs font-medium text-text-secondary">
                    {group.label}
                  </span>
                  <span className="ml-auto text-[11px] text-text-muted tabular-nums">
                    {group.sessions.length}
                  </span>
                </button>
                {expanded &&
                  group.sessions.map((s, index) => {
                    const live = nowMs - s.mtimeMs < LIVE_WINDOW_MS;
                    const key = sessionKey(s);
                    const revealed = hoveredKey === key || focusedKey === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onSelect(s)}
                        onMouseEnter={() => setHoveredKey(key)}
                        onMouseLeave={() => setHoveredKey((prev) => (prev === key ? null : prev))}
                        onFocus={() => setFocusedKey(key)}
                        onBlur={() => setFocusedKey((prev) => (prev === key ? null : prev))}
                        className="flex items-center gap-3 w-full px-4 py-3 text-left border-t border-border/50 cursor-pointer hover:bg-surface-elevated transition-colors row-enter"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <span
                          className={`inline-block w-2 h-2 rounded-full shrink-0 ${live ? "bg-ok" : "bg-border"}`}
                          aria-label={live ? "live" : undefined}
                        />
                        <span className="flex-1 min-w-0 truncate text-sm text-text-primary">
                          {s.title || s.id}
                        </span>
                        {revealed ? (
                          <span className="flex items-center gap-2 text-[11px] text-text-muted">
                            {s.model && (
                              <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-text-secondary">
                                {shortModel(s.model)}
                              </span>
                            )}
                            {s.isArchived && (
                              <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                                archived
                              </span>
                            )}
                            <span className="tabular-nums">{relativeTime(s.mtimeMs, nowMs)}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-muted tabular-nums">
                            {relativeTime(s.mtimeMs, nowMs)}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
    </div>
  );
}

function SavingsHeadlineStrip({
  totals,
}: {
  totals: AllWorkspaceTokenSaverTotals | null;
}): JSX.Element {
  // No savings yet (or totals unavailable) -> an honest prompt, never a fake $0.
  if (!totals || totals.bytesSavedTotal === 0) {
    return (
      <div
        data-testid="savings-headline"
        className="mb-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-muted"
      >
        No savings recorded yet — enable the saver to start.
      </div>
    );
  }

  const headline = computeSavingsHeadline(totals);
  const dollars = formatDollarsSaved(headline.dollarsSaved);
  // One decimal, matching the CLI — the reclaim metric under-counts on purpose,
  // so it must never round UP (0.6 -> "0.6", never "1").
  const reclaimed = headline.contextWindowsReclaimed.toFixed(1);
  return (
    <div
      data-testid="savings-headline"
      title={SAVINGS_FOOTNOTE}
      className="mb-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-primary"
    >
      <span className="font-semibold tabular-nums">≈{dollars} saved (est.)</span>
      <span className="text-text-muted"> · </span>
      <span className="tabular-nums">≈{reclaimed} sessions reclaimed</span>
    </div>
  );
}
