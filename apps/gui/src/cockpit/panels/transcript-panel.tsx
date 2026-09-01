import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type NormalizedMessage,
  openClaudeSessionStream,
} from "../../lib/claude-sessions-client.js";
import type { CockpitPanelProps } from "../panel.js";

const STICKY_THRESHOLD_PX = 80;

export function TranscriptPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [streamError, setStreamError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Tracks whether the user is at/near bottom so we don't yank them when they scrolled up.
  const stickToBottomRef = useRef(true);
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    setMessages([]);
    setStreamError(false);
    hasSnapshotRef.current = false;
    stickToBottomRef.current = true;
    // Any subsequent snapshot/message clears the banner, so a brief SSE reconnect
    // does not permanently show "unavailable" (EventSource fires error on every
    // disconnect). The error banner only sticks when no data ever arrives.
    const dispose = openClaudeSessionStream(dir, id, {
      onSnapshot: (snap) => {
        hasSnapshotRef.current = true;
        setStreamError(false);
        setMessages(snap.messages);
      },
      onMessage: (msg) => {
        hasSnapshotRef.current = true;
        setStreamError(false);
        setMessages((prev) => [...prev, msg]);
      },
      onError: () => {
        if (!hasSnapshotRef.current) setStreamError(true);
      },
    });
    return dispose;
  }, [dir, id]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < STICKY_THRESHOLD_PX;
  };

  const scrollToBottom = (smooth: boolean): void => {
    const el = scrollRef.current;
    if (!el) return;
    // Double rAF: wait for React DOM flush + browser layout so scrollHeight is final, especially for the initial large snapshot.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = endRef.current;
        if (target && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "end" });
        } else {
          if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          else el.scrollTop = el.scrollHeight;
        }
      });
    });
  };

  // Chatbot-like sticky bottom: stay pinned to last message as new chunks stream in.
  // useLayoutEffect runs after DOM mutation but before paint, so the user never sees the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollRef/endRef are stable refs; stickToBottomRef is a mutable guard
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    // First paint of a new transcript should always land at bottom; thereafter respect user scroll.
    // Use a micro heuristic: if we just mounted a new session (messages replaced wholesale) distance check would be 0-0,
    // so the stickToBottomRef reset above guarantees the first render scrolls.
    if (!stickToBottomRef.current) return;
    // Snapshot (large batch) -> instant jump; incremental streaming -> smooth follow for better feel.
    // We can't distinguish snapshot vs single message reliably from length alone,
    // but a heuristic: if we jumped by >1 message, treat as snapshot.
    // For now always use instant on first mount smoothness handled by rAF; smooth for subsequent appends could be jarring on huge snapshots,
    // so keep it instant. The caller can flip to smooth if desired.
    scrollToBottom(false);
  }, [messages]);

  return (
    <section
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 gap-3"
    >
      {streamError && (
        <div className="rounded-md border border-border bg-surface-elevated px-3 py-2 text-xs text-text-muted">
          Live stream unavailable for this session. It may have been removed or is managed by
          another harness. It will disappear from the list on the next refresh.
        </div>
      )}
      {messages.map((m, i) => (
        <div key={`${m.ts}-${i}`} className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-text-muted">{m.role}</span>
          {m.blocks.map((b, j) =>
            b.kind === "thinking" ? (
              <details
                key={`${m.ts}-${i}-${j}`}
                className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 border-l-4 border-l-amber-400"
              >
                <summary className="cursor-pointer list-none flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-amber-700 select-none">
                  <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-amber-800 border border-amber-200">
                    Thinking
                  </span>
                  <span className="text-text-muted font-normal normal-case tracking-normal text-xs">
                    ▾
                  </span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-amber-900/80 italic">
                  {b.text}
                </pre>
              </details>
            ) : (
              <pre
                key={`${m.ts}-${i}-${j}`}
                className={[
                  "whitespace-pre-wrap break-words text-xs leading-relaxed rounded-md px-3 py-2 border border-border",
                  b.kind === "tool_use" || b.kind === "tool_result"
                    ? "text-text-secondary bg-surface-elevated font-mono"
                    : "text-text-primary bg-surface",
                ].join(" ")}
              >
                {b.text}
              </pre>
            ),
          )}
        </div>
      ))}
      <div ref={endRef} aria-hidden className="h-px shrink-0" />
    </section>
  );
}
