import { useCallback, useEffect, useState } from "react";
import type { BridgeError } from "../components/states.js";
import { ErrorState, LoadingState } from "../components/states.js";
import { type ClaudeSessionMeta, fetchClaudeSessions } from "../lib/claude-sessions-client.js";
import { groupSessionsByCwd } from "../lib/workspace-grouping.js";

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

function shortModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
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

  const groups = groupSessionsByCwd(sessions);

  const toggleGroup = (cwd: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  };

  const loadList = useCallback((): void => {
    fetchClaudeSessions(50, 0)
      .then((list) => {
        setSessions(list);
        setListState("ready");
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

  if (listState === "loading") return <LoadingState label="Loading Claude Code sessions…" />;
  if (listState === "error" && listError)
    return <ErrorState error={listError} onRetry={loadList} />;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {groups.length === 0 && (
        <p className="px-3 py-4 text-xs text-text-muted">
          No Claude Code sessions found in ~/.claude/projects.
        </p>
      )}
      {groups.map((group) => {
        const expanded = !collapsed.has(group.cwd);
        const groupLive = group.sessions.some((r) => nowMs - r.mtimeMs < LIVE_WINDOW_MS);
        return (
          <div key={group.cwd}>
            <button
              type="button"
              onClick={() => toggleGroup(group.cwd)}
              aria-expanded={expanded}
              title={group.cwd}
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
                {group.label}
              </span>
              <span className="ml-auto text-[10px] text-text-muted">{group.sessions.length}</span>
            </button>
            {expanded &&
              group.sessions.map((s) => {
                const live = nowMs - s.mtimeMs < LIVE_WINDOW_MS;
                return (
                  <button
                    key={`${s.dir}/${s.id}`}
                    type="button"
                    onClick={() => onSelect(s)}
                    className="flex flex-col gap-0.5 pl-5 pr-3 py-2 text-left border-b border-border/50 cursor-pointer w-full hover:bg-surface-elevated"
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
    </div>
  );
}
