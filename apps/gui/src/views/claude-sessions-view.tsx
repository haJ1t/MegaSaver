import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeError } from "../components/states.js";
import { ErrorState, LoadingState } from "../components/states.js";
import {
  type ClaudeSessionMeta,
  type NormalizedMessage,
  type SessionTelemetry,
  type Workspace,
  fetchClaudeSessionTelemetry,
  fetchClaudeSessions,
  fetchWorkspaces,
  openClaudeSessionStream,
} from "../lib/claude-sessions-client.js";

const LIST_POLL_MS = 4000;
const LIVE_WINDOW_MS = 8000;

function relativeTime(mtimeMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - mtimeMs);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Strip the trailing -YYYYMMDD date suffix Claude model ids carry, for a compact badge.
function shortModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

function durationLabel(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type SessionGroup = { label: string; rows: ClaudeSessionMeta[] };

// Group rows by their cwd (projectLabel) and order the groups by the
// server-provided workspaces (recent-first). When the workspaces fetch is
// missing or disagrees mid-poll, fall back to deriving the order from the
// rows themselves so a header never appears without its rows (spec §6 risk 3).
function groupRows(sessions: ClaudeSessionMeta[], workspaces: Workspace[]): SessionGroup[] {
  const byLabel = new Map<string, ClaudeSessionMeta[]>();
  for (const s of sessions) {
    if (s.projectLabel.length === 0) continue;
    const rows = byLabel.get(s.projectLabel);
    if (rows) rows.push(s);
    else byLabel.set(s.projectLabel, [s]);
  }
  for (const rows of byLabel.values()) rows.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const w of workspaces) {
    if (byLabel.has(w.label) && !seen.has(w.label)) {
      ordered.push(w.label);
      seen.add(w.label);
    }
  }
  const remaining = [...byLabel.keys()].filter((l) => !seen.has(l));
  remaining.sort((a, b) => {
    const am = byLabel.get(a)?.[0]?.mtimeMs ?? 0;
    const bm = byLabel.get(b)?.[0]?.mtimeMs ?? 0;
    return bm - am;
  });
  ordered.push(...remaining);

  return ordered.map((label) => ({ label, rows: byLabel.get(label) ?? [] }));
}

function folderName(label: string): string {
  const parts = label.split("/").filter((p) => p.length > 0);
  return parts.at(-1) ?? label;
}

export function ClaudeSessionsView(): JSX.Element {
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<BridgeError | null>(null);
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [streamError, setStreamError] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showArchived, setShowArchived] = useState(false);
  const [telemetry, setTelemetry] = useState<SessionTelemetry | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleSessions = sessions.filter((s) => showArchived || !s.isArchived);
  const groups = groupRows(visibleSessions, workspaces);

  const toggleGroup = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const loadList = useCallback((): void => {
    fetchClaudeSessions(50, 0)
      .then((list) => {
        setSessions(list);
        setListState("ready");
        // Headers are best-effort: a workspaces 500 leaves grouping to the
        // client-side fallback derived from the session list itself.
        fetchWorkspaces(50, 0)
          .then(setWorkspaces)
          .catch(() => setWorkspaces([]));
      })
      .catch((err: unknown) => {
        setListError(err as BridgeError);
        setListState("error");
      });
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(() => {
      loadList();
      setNowMs(Date.now());
    }, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    setMessages([]);
    setStreamError(false);
    const dispose = openClaudeSessionStream(selected.dir, selected.id, {
      onSnapshot: (snap) => setMessages(snap.messages),
      onMessage: (msg) => setMessages((prev) => [...prev, msg]),
      onError: () => setStreamError(true),
    });
    return dispose;
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setTelemetry(null);
      return;
    }
    let live = true;
    setTelemetry(null);
    fetchClaudeSessionTelemetry(selected.dir, selected.id)
      .then((t) => {
        if (live) setTelemetry(t);
      })
      .catch(() => {
        if (live) setTelemetry(null);
      });
    return () => {
      live = false;
    };
  }, [selected]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollRef is a stable ref, intentionally omitted from deps; effect re-runs only on messages change to auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (listState === "loading") return <LoadingState label="Loading Claude Code sessions…" />;
  if (listState === "error" && listError)
    return <ErrorState error={listError} onRetry={loadList} />;

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="flex flex-col w-72 shrink-0 border-r border-border overflow-y-auto">
        <label className="flex items-center gap-2 px-3 py-2 text-[11px] text-text-muted border-b border-border cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        {groups.length === 0 && (
          <p className="px-3 py-4 text-xs text-text-muted">
            No Claude Code sessions found in ~/.claude/projects.
          </p>
        )}
        {groups.map((group) => {
          const expanded = !collapsed.has(group.label);
          const groupLive = group.rows.some((r) => nowMs - r.mtimeMs < LIVE_WINDOW_MS);
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={expanded}
                title={group.label}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left border-b border-border bg-surface cursor-pointer"
              >
                <span className="text-text-muted text-[10px]">{expanded ? "▾" : "▸"}</span>
                {groupLive && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                    aria-label="live"
                  />
                )}
                <span className="truncate text-xs font-medium text-text-secondary">
                  {folderName(group.label)}
                </span>
                <span className="ml-auto text-[10px] text-text-muted">{group.rows.length}</span>
              </button>
              {expanded &&
                group.rows.map((s) => {
                  const live = nowMs - s.mtimeMs < LIVE_WINDOW_MS;
                  const active = selected?.dir === s.dir && selected?.id === s.id;
                  return (
                    <button
                      key={`${s.dir}/${s.id}`}
                      type="button"
                      onClick={() => setSelected(s)}
                      aria-current={active ? "true" : undefined}
                      className={[
                        "flex flex-col gap-0.5 pl-5 pr-3 py-2 text-left border-b border-border/50 cursor-pointer w-full",
                        active ? "bg-accent/15" : "hover:bg-surface-elevated",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-1.5 text-xs text-text-primary truncate">
                        {live && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                            aria-label="live"
                          />
                        )}
                        <span className="truncate">{s.title || s.id}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
                        <span>{relativeTime(s.mtimeMs, nowMs)}</span>
                        {s.model && (
                          <span className="px-1 rounded bg-surface-elevated text-text-secondary">
                            {shortModel(s.model)}
                          </span>
                        )}
                        {s.isArchived && (
                          <span className="px-1 rounded bg-surface-elevated text-text-muted">
                            archived
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </aside>

      <section
        ref={scrollRef}
        className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 gap-3"
      >
        {!selected && (
          <p className="text-sm text-text-muted py-8">Pick a session to view its transcript.</p>
        )}
        {streamError && (
          <p className="text-xs text-danger">
            Live stream interrupted. Reselect the session to retry.
          </p>
        )}
        {selected && telemetry && (
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
              Session telemetry (LLM context tokens)
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary">
              <span>{telemetry.turnCount} turns</span>
              <span>{telemetry.assistantTurns} assistant</span>
              <span>{telemetry.toolCallCount} tool calls</span>
              <span>{durationLabel(telemetry.durationMs)} duration</span>
              <span>{telemetry.totals.inputTokens} in</span>
              <span>{telemetry.totals.outputTokens} out</span>
              <span>{telemetry.totals.cacheCreationInputTokens} cache-create</span>
              <span>{telemetry.totals.cacheReadInputTokens} cache-read</span>
              {telemetry.gitBranch && <span>branch {telemetry.gitBranch}</span>}
            </div>
            {telemetry.models.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-0.5 text-text-muted">
                {telemetry.models.map((mu) => (
                  <span key={mu.model}>
                    {shortModel(mu.model)} — {mu.turns} turns, {mu.inputTokens} in /{" "}
                    {mu.outputTokens} out
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {selected &&
          messages.map((m, i) => (
            <div key={`${m.ts}-${i}`} className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-text-muted">
                {m.role}
              </span>
              {m.blocks.map((b, j) => (
                <pre
                  key={`${m.ts}-${i}-${j}`}
                  className={[
                    "whitespace-pre-wrap break-words text-xs leading-relaxed rounded-md px-3 py-2 border border-border",
                    b.kind === "thinking"
                      ? "text-text-muted italic bg-surface"
                      : b.kind === "tool_use" || b.kind === "tool_result"
                        ? "text-text-secondary bg-surface-elevated font-mono"
                        : "text-text-primary bg-surface",
                  ].join(" ")}
                >
                  {b.text}
                </pre>
              ))}
            </div>
          ))}
      </section>
    </div>
  );
}
