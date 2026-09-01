import { type FormEvent, useCallback, useEffect, useState } from "react";
import { BrainSyncCard } from "../../components/brain-sync-card.js";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type MemoryExplainResponse,
  type MemoryHistoryResponse,
  type OverlayMemoryEntry,
  createSessionMemory,
  deleteSessionMemory,
  fetchMemoryExplain,
  fetchMemoryHistory,
  fetchSessionMemory,
  reopenSessionMemory,
} from "../../lib/claude-sessions-client.js";

export function MemoryPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [rows, setRows] = useState<OverlayMemoryEntry[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"session" | "project">("session");
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [activeHistory, setActiveHistory] = useState<MemoryHistoryResponse | null>(null);
  const [activeExplain, setActiveExplain] = useState<MemoryExplainResponse | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce intentionally re-triggers the load effect
  useEffect(() => {
    let live = true;
    setState("loading");
    setError(null);
    fetchSessionMemory(dir, id)
      .then((list) => {
        if (!live) return;
        setRows(list);
        setState("ready");
      })
      .catch((err) => {
        if (!live) return;
        setError(err as BridgeError);
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [dir, id, refreshNonce]);

  const retry = (): void => setRefreshNonce((n) => n + 1);

  const onCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const content = draft.trim();
      if (content.length === 0) return;
      try {
        const created = await createSessionMemory(dir, id, { content, scope });
        setRows((prev) => [created, ...(prev ?? [])]);
        setDraft("");
      } catch (err) {
        setError(err as BridgeError);
        setState("error");
      }
    },
    [dir, id, draft, scope],
  );

  const onDelete = useCallback(
    async (entryId: string) => {
      try {
        await deleteSessionMemory(dir, id, entryId);
        setRows((prev) => (prev ?? []).filter((r) => r.id !== entryId));
      } catch (err) {
        setError(err as BridgeError);
        setState("error");
      }
    },
    [dir, id],
  );

  const onHistory = useCallback(
    async (entryId: string) => {
      try {
        const history = await fetchMemoryHistory(dir, id, entryId);
        setActiveHistory(history);
      } catch (err) {
        setError(err as BridgeError);
      }
    },
    [dir, id],
  );

  const onExplain = useCallback(
    async (entryId: string) => {
      try {
        const explain = await fetchMemoryExplain(dir, id, entryId);
        setActiveExplain(explain);
      } catch (err) {
        setError(err as BridgeError);
      }
    },
    [dir, id],
  );

  const onReopen = useCallback(
    async (entryId: string) => {
      try {
        const updated = await reopenSessionMemory(dir, id, entryId);
        setRows((prev) => (prev ?? []).map((r) => (r.id === entryId ? updated : r)));
      } catch (err) {
        setError(err as BridgeError);
      }
    },
    [dir, id],
  );

  return (
    <section
      aria-label="Session memory"
      className="flex flex-col gap-3 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h3 className="text-sm text-text-muted uppercase tracking-widest">Memory (Living Brain)</h3>

      <BrainSyncCard dir={dir} id={id} />

      <form onSubmit={onCreate} className="flex flex-col gap-2">
        <label htmlFor="memory-draft" className="text-xs text-text-muted">
          New note
        </label>
        <textarea
          id="memory-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
          rows={2}
        />
        <div className="flex items-center gap-2">
          <select
            aria-label="Memory scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as "session" | "project")}
            className="px-2 py-1 rounded-md border border-border bg-surface-elevated text-xs"
          >
            <option value="session">This session</option>
            <option value="project">Whole workspace</option>
          </select>
          <button
            type="submit"
            className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer"
          >
            Add note
          </button>
        </div>
      </form>

      {state === "loading" && <LoadingState label="Loading memory…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={retry} />}
      {state === "ready" && rows && rows.length === 0 && (
        <p className="text-xs text-text-muted">No memory yet.</p>
      )}

      {activeHistory && (
        <div className="p-3 rounded-md border border-border bg-surface-elevated text-xs flex flex-col gap-1">
          <div className="flex justify-between items-center font-semibold">
            <span>Lineage History</span>
            <button
              type="button"
              onClick={() => setActiveHistory(null)}
              className="text-text-muted cursor-pointer"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] text-text-muted">
            Entry: {activeHistory.entryId} (Chain: {activeHistory.chain.length} versions)
          </p>
        </div>
      )}

      {activeExplain && (
        <div className="p-3 rounded-md border border-border bg-surface-elevated text-xs flex flex-col gap-1">
          <div className="flex justify-between items-center font-semibold">
            <span>Memory Ranking Explain</span>
            <button
              type="button"
              onClick={() => setActiveExplain(null)}
              className="text-text-muted cursor-pointer"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] text-text-muted">
            Confidence: {activeExplain.confidence} (Effective: {activeExplain.effectiveConfidence})
            | Source: {activeExplain.source}
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start gap-2 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
            >
              <span className="text-text-primary flex-1">{row.content}</span>
              <span className="text-text-muted">{row.scope}</span>
              <button
                type="button"
                onClick={() => onHistory(row.id)}
                className="text-text-muted hover:text-text-primary cursor-pointer text-[11px]"
              >
                History
              </button>
              <button
                type="button"
                onClick={() => onExplain(row.id)}
                className="text-text-muted hover:text-text-primary cursor-pointer text-[11px]"
              >
                Explain
              </button>
              {row.validTo != null && (
                <button
                  type="button"
                  onClick={() => onReopen(row.id)}
                  className="text-accent hover:underline cursor-pointer text-[11px]"
                >
                  Reopen
                </button>
              )}
              <button
                type="button"
                aria-label={`Delete ${row.title}`}
                onClick={() => onDelete(row.id)}
                className="text-text-muted hover:text-text-primary cursor-pointer"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
