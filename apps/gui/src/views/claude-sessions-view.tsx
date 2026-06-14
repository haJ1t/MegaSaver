import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeError } from "../components/states.js";
import { ErrorState, LoadingState } from "../components/states.js";
import {
  type ClaudeSessionMeta,
  type NormalizedMessage,
  fetchClaudeSessions,
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

export function ClaudeSessionsView(): JSX.Element {
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<BridgeError | null>(null);
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [streamError, setStreamError] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);

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
        {sessions.length === 0 && (
          <p className="px-3 py-4 text-xs text-text-muted">
            No Claude Code sessions found in ~/.claude/projects.
          </p>
        )}
        {sessions.map((s) => {
          const live = nowMs - s.mtimeMs < LIVE_WINDOW_MS;
          const active = selected?.dir === s.dir && selected?.id === s.id;
          return (
            <button
              key={`${s.dir}/${s.id}`}
              type="button"
              onClick={() => setSelected(s)}
              aria-current={active ? "true" : undefined}
              className={[
                "flex flex-col gap-0.5 px-3 py-2 text-left border-b border-border/50 cursor-pointer",
                active ? "bg-accent/15" : "hover:bg-surface-elevated",
              ].join(" ")}
            >
              <span className="flex items-center gap-1.5 text-xs text-text-secondary truncate">
                {live && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                    aria-label="live"
                  />
                )}
                <span className="truncate">{s.projectLabel || s.dir}</span>
              </span>
              <span className="text-xs text-text-primary truncate">{s.title || s.id}</span>
              <span className="text-[10px] text-text-muted">{relativeTime(s.mtimeMs, nowMs)}</span>
            </button>
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
