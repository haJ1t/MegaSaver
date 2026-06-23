import { useEffect, useRef, useState } from "react";
import type { BridgeError } from "../../components/states.js";
import {
  type TranscriptEntry,
  fetchTranscript,
  openTranscriptStream,
} from "../../lib/office-client.js";

function TranscriptLine({ entry }: { entry: TranscriptEntry }): JSX.Element {
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
  const bottomRef = useRef<HTMLDivElement | null>(null);

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
  );
}
