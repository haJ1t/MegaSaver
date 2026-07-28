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
    <div className="max-w-[1180px] flex flex-col gap-4 px-5 py-7">
      <div className="flex items-end gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Sessions</h1>
          <p className="mt-1 mb-0 text-text-secondary">
            Every Claude Code session on this machine, grouped by working directory.
          </p>
        </div>
        <div className="flex gap-6 pb-1">
          <SummaryStat label="Workspaces" value={groups.length} />
          <SummaryStat label="Sessions" value={sessions.length} />
          <SummaryStat label="Live" value={liveCount} accent />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <SavingsHeadlineStrip totals={savingsTotals} />
        </div>
        {hasSavings && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="shrink-0 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-elevated cursor-pointer transition-colors"
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
        <div data-testid="session-list-card" className="flex flex-col gap-3.5">
          {groups.map((group) => {
            const expanded = !collapsed.has(group.cwd);
            return (
              <section
                key={group.cwd}
                className="rounded-xl border border-border bg-surface overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.cwd)}
                  aria-expanded={expanded}
                  title={group.cwd}
                  className="flex items-center gap-2.5 w-full px-4 py-3 text-left cursor-pointer hover:bg-surface-elevated transition-colors"
                >
                  <span aria-hidden="true" className="w-2.5 text-text-muted text-2xs">
                    {expanded ? "▾" : "▸"}
                  </span>
                  <span className="font-semibold">{group.label}</span>
                  <span className="truncate font-mono text-xs text-text-muted">{group.cwd}</span>
                  <span className="ml-auto font-mono text-xs text-text-muted">
                    {group.sessions.length} sessions
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
                        className="flex items-center gap-3 w-full px-4 py-3 text-left border-t border-line-soft cursor-pointer hover:bg-surface-elevated transition-colors row-enter"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <span
                          className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 ${live ? "bg-ok pulse-dot" : "bg-border"}`}
                          aria-label={live ? "live" : undefined}
                        />
                        <span className="flex-1 min-w-0 truncate text-text-primary">
                          {s.title || s.id}
                        </span>
                        {revealed ? (
                          <span className="flex items-center gap-2 font-mono text-xs text-text-muted">
                            {s.model && (
                              <span className="px-2 py-0.5 rounded-sm bg-surface-elevated text-text-secondary">
                                {shortModel(s.model)}
                              </span>
                            )}
                            {s.isArchived && (
                              <span className="px-2 py-0.5 rounded-sm bg-surface-elevated text-text-muted">
                                archived
                              </span>
                            )}
                            <span className="tabular-nums">{relativeTime(s.mtimeMs, nowMs)}</span>
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-text-muted tabular-nums">
                            {relativeTime(s.mtimeMs, nowMs)}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean | undefined;
}): JSX.Element {
  return (
    <span>
      <span
        className={`block font-mono text-xl tabular-nums ${accent ? "text-ok" : "text-text-primary"}`}
      >
        {value}
      </span>
      <span className="text-2xs uppercase tracking-[0.08em] text-text-muted">{label}</span>
    </span>
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
        className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-muted"
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
