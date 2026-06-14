import { useEffect, useRef, useState } from "react";
import {
  type NormalizedMessage,
  openClaudeSessionStream,
} from "../../lib/claude-sessions-client.js";
import type { CockpitPanelProps } from "../panel.js";

export function TranscriptPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [streamError, setStreamError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setStreamError(false);
    const dispose = openClaudeSessionStream(dir, id, {
      onSnapshot: (snap) => setMessages(snap.messages),
      onMessage: (msg) => setMessages((prev) => [...prev, msg]),
      onError: () => setStreamError(true),
    });
    return dispose;
  }, [dir, id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollRef is a stable ref, intentionally omitted from deps; effect re-runs only on messages change to auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <section
      ref={scrollRef}
      className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 gap-3"
    >
      {streamError && (
        <p className="text-xs text-danger">
          Live stream interrupted. Reselect the session to retry.
        </p>
      )}
      {messages.map((m, i) => (
        <div key={`${m.ts}-${i}`} className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-text-muted">{m.role}</span>
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
  );
}
