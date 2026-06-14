import type { BlockSearchHit } from "@megasaver/indexer";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { type IndexStatus, fetchIndexStatus, searchIndex } from "../lib/api-client.js";

export function IndexView({ projectId }: { projectId: string }): JSX.Element {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BlockSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setStatus(await fetchIndexStatus(projectId));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    setHits(null);
    setQ("");
  }, [load]);

  async function runSearch(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (q.trim().length === 0) return;
    setSearching(true);
    setSearchError(null);
    try {
      setHits(await searchIndex(projectId, { q: q.trim(), limit: 50 }));
    } catch (err) {
      setSearchError(err as BridgeError);
      setHits(null);
    } finally {
      setSearching(false);
    }
  }

  return (
    <section
      aria-label="Index"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Semantic index</h2>

      {state === "loading" && <LoadingState label="Loading index status…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}

      {state === "ready" && status && !status.indexed && (
        <EmptyState
          title="No index yet."
          description="Build it from the terminal: mega index build <project>"
        />
      )}

      {state === "ready" && status?.indexed && (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="Blocks" value={status.total} />
            <Stat label="Files" value={status.indexedFiles} />
            {Object.entries(status.byType)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([type, n]) => (
                <Stat key={type} label={type} value={n} />
              ))}
          </div>

          <form onSubmit={runSearch} className="flex items-center gap-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search blocks…"
              aria-label="Index search query"
              className="px-2 py-1 text-xs bg-surface-elevated border border-border rounded-md text-text-primary w-72 focus-visible:outline-2 focus-visible:outline-offset-2"
            />
            <button
              type="submit"
              className="px-3 py-1 text-xs rounded-md bg-accent text-accent-fg cursor-pointer hover:opacity-90"
            >
              Search
            </button>
          </form>

          {searching && <LoadingState label="Searching…" />}
          {searchError && <ErrorState error={searchError} />}
          {hits !== null && hits.length === 0 && !searching && (
            <p className="text-xs text-text-muted">No matches.</p>
          )}
          {hits !== null && hits.length > 0 && (
            <ul className="flex flex-col gap-1">
              {hits.map(({ block, score }) => (
                <li
                  key={block.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
                >
                  <span className="text-text-muted w-10 shrink-0">{score.toFixed(2)}</span>
                  <span className="px-1.5 py-0.5 rounded bg-accent/15 text-text-secondary shrink-0">
                    {block.blockType}
                  </span>
                  <span className="font-mono text-text-secondary truncate">
                    {block.filePath}:{block.startLine}
                  </span>
                  <span className="text-text-primary ml-auto truncate">{block.name ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex flex-col items-start px-3 py-2 rounded-md border border-border bg-surface-elevated min-w-[5rem]">
      <span className="text-sm text-text-primary font-medium tabular-nums">{value}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  );
}
