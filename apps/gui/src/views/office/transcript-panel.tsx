import { useEffect, useRef, useState } from "react";
import type { BridgeError } from "../../components/states.js";
import {
  type TranscriptEntry,
  fetchTranscript,
  openTranscriptStream,
  sendChat,
} from "../../lib/office-client.js";

function TranscriptLine({ entry }: { entry: TranscriptEntry }): JSX.Element {
  if (entry.role === "user") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[9px] text-text-muted uppercase tracking-wide">You</span>
        <div className="text-xs text-accent-fg bg-accent rounded px-2 py-1 max-w-[85%] whitespace-pre-wrap break-words">
          {entry.text}
        </div>
      </div>
    );
  }
  if (entry.role === "assistant") {
    return (
      <div className="text-xs text-text-primary whitespace-pre-wrap break-words">{entry.text}</div>
    );
  }
  if (entry.role === "tool") {
    return (
      <div className="text-[11px] text-text-secondary font-mono">
        ▸ {entry.tool}
        {entry.summary ? ` ${entry.summary}` : ""}
      </div>
    );
  }
  if (entry.role === "result") {
    return (
      <div className="text-[11px] text-text-muted uppercase tracking-wide">{entry.summary}</div>
    );
  }
  // tool_result / stderr — muted detail
  return (
    <div className="text-[11px] text-text-muted whitespace-pre-wrap break-words">
      {entry.summary}
    </div>
  );
}

type TranscriptPanelProps = {
  wk: string;
  agentId: string;
};

export function TranscriptPanel({ wk, agentId }: TranscriptPanelProps): JSX.Element {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  function submitMessage(): void {
    const text = message.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setChatError(null);
    sendChat(wk, agentId, text)
      .then(() => setMessage(""))
      .catch((err: unknown) => setChatError((err as BridgeError).error ?? "Failed to send"))
      .finally(() => setSending(false));
  }

  // Reload backlog + open the live stream whenever the selected agent changes.
  // The `ignore` flag prevents a late backlog response for a previous agent
  // from clobbering the newly selected agent's feed.
  useEffect(() => {
    let ignore = false;
    setEntries([]);
    setError(null);
    setStreamError(false);

    fetchTranscript(wk, agentId)
      .then((list) => {
        if (!ignore) setEntries(list);
      })
      .catch((err: unknown) => {
        if (!ignore) setError((err as BridgeError).error ?? "Failed to load transcript");
      });

    const close = openTranscriptStream(wk, agentId, {
      onEntry: (entry) => {
        if (ignore) return;
        // Dedup by id; keep ts,seq order.
        setEntries((prev) =>
          prev.some((e) => e.id === entry.id)
            ? prev
            : [...prev, entry].sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq),
        );
        setStreamError(false);
      },
      onError: () => {
        if (!ignore) setStreamError(true);
      },
    });

    return () => {
      ignore = true;
      close();
    };
  }, [wk, agentId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to newest on every append
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [entries.length]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 p-3 border border-border rounded-md bg-surface-elevated max-h-80 overflow-y-auto">
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {streamError && (
          <p role="alert" className="text-[10px] text-warn">
            Live stream disconnected
          </p>
        )}
        {entries.length === 0 && !error ? (
          <p className="text-[11px] text-text-muted">No activity yet for this agent.</p>
        ) : (
          entries.map((entry) => <TranscriptLine key={entry.id} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitMessage();
        }}
        className="flex items-end gap-1.5"
      >
        <textarea
          aria-label="Message agent"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitMessage();
            }
          }}
          rows={2}
          placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
          className="flex-1 text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary resize-none"
        />
        <button
          type="submit"
          disabled={sending || message.trim().length === 0}
          className="text-xs px-3 py-1 rounded bg-accent text-accent-fg cursor-pointer disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {chatError && (
        <p role="alert" className="text-[10px] text-danger">
          {chatError}
        </p>
      )}
    </div>
  );
}
