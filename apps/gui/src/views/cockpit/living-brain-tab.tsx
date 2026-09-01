import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

export function LivingBrainTab({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [rows, setRows] = useState<OverlayMemoryEntry[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"session" | "project">("project");
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
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

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (filterType !== "all" && r.type !== filterType) return false;
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const text = `${r.content} ${r.type ?? ""} ${r.scope} ${r.source ?? ""}`.toLowerCase();
        return text.includes(q);
      }
      return true;
    });
  }, [rows, filterType, searchQuery]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-6 w-full">
      {/* Left Column: Living Brain Sync Status & Controls */}
      <div className="flex flex-col gap-4">
        <BrainSyncCard dir={dir} id={id} />

        {/* Quick Add Memory Note */}
        <div className="p-4 rounded-xl border border-border bg-surface flex flex-col gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted m-0">
            Create Memory Note
          </h4>
          <form onSubmit={onCreate} className="flex flex-col gap-2.5">
            <textarea
              aria-label="New memory note"
              placeholder="Record a decision, architecture rule, or convention…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface-elevated text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent"
              rows={3}
            />
            <div className="flex items-center justify-between gap-2">
              <select
                aria-label="Memory scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as "session" | "project")}
                className="px-2.5 py-1 rounded-md border border-border bg-surface-elevated text-xs text-text-primary"
              >
                <option value="project">Whole workspace</option>
                <option value="session">This session</option>
              </select>
              <button
                type="submit"
                className="px-3.5 py-1 rounded-md bg-accent text-accent-fg text-xs font-medium cursor-pointer hover:opacity-90 transition-opacity"
              >
                Add Note
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Right Column: Full Memory List with Search & Filtering */}
      <div className="flex flex-col gap-4 p-5 rounded-xl border border-border bg-surface">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-text-primary m-0">Active Memory Notes</h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-elevated border border-border text-text-muted">
              {filteredRows.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <input
              type="text"
              placeholder="Search memories…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-border bg-surface-elevated text-xs text-text-primary placeholder:text-text-muted w-44"
            />

            {/* Filter */}
            <select
              aria-label="Filter category"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-border bg-surface-elevated text-xs text-text-primary"
            >
              <option value="all">All Types</option>
              <option value="decision">Decisions</option>
              <option value="architecture">Architecture</option>
              <option value="bug">Bugs</option>
              <option value="convention">Conventions</option>
            </select>
          </div>
        </div>

        {/* States */}
        {state === "loading" && <LoadingState label="Loading Living Brain memories…" />}
        {state === "error" && error && <ErrorState error={error} onRetry={retry} />}
        {state === "ready" && filteredRows.length === 0 && (
          <div className="py-12 text-center text-text-muted text-xs">
            {rows && rows.length > 0
              ? "No memories match your filter criteria."
              : "No memories recorded yet for this workspace."}
          </div>
        )}

        {/* List */}
        {state === "ready" && filteredRows.length > 0 && (
          <ul
            aria-label="Memory entries"
            className="list-none m-0 p-0 flex flex-col gap-2 max-h-[550px] overflow-y-auto"
          >
            {filteredRows.map((r) => {
              const closed = r.validTo !== null;
              return (
                <li
                  key={r.id}
                  className={`p-3.5 rounded-lg border transition-all flex flex-col gap-2 ${
                    closed
                      ? "bg-surface-elevated/40 border-border/50 opacity-60"
                      : "bg-surface-elevated border-border hover:border-accent/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-text-primary m-0 leading-relaxed font-sans">
                      {r.content}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        aria-label="Explain memory"
                        onClick={() => onExplain(r.id)}
                        className="px-2 py-0.5 rounded border border-border text-2xs text-text-muted hover:text-text-primary hover:bg-background"
                      >
                        Explain
                      </button>
                      <button
                        type="button"
                        aria-label="Memory history"
                        onClick={() => onHistory(r.id)}
                        className="px-2 py-0.5 rounded border border-border text-2xs text-text-muted hover:text-text-primary hover:bg-background"
                      >
                        History
                      </button>
                      {closed ? (
                        <button
                          type="button"
                          aria-label="Reopen memory"
                          onClick={() => onReopen(r.id)}
                          className="px-2 py-0.5 rounded border border-accent/40 text-2xs text-accent hover:bg-accent/10"
                        >
                          Reopen
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label="Delete note"
                          onClick={() => onDelete(r.id)}
                          className="px-2 py-0.5 rounded border border-border text-2xs text-red-500 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-2xs text-text-muted">
                    <span className="px-1.5 py-0.5 rounded bg-background border border-border font-mono">
                      {r.scope}
                    </span>
                    {r.type && (
                      <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium uppercase tracking-wider">
                        {r.type}
                      </span>
                    )}
                    {r.confidence && <span>confidence: {r.confidence}</span>}
                    {closed && <span className="text-amber-500 font-medium">superseded</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* History Modal */}
        {activeHistory && (
          // biome-ignore lint/a11y/useSemanticElements: overlay styled as fixed scrim, requires div with dialog role
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Memory history"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
          >
            <div className="w-full max-w-md p-5 rounded-xl border border-border bg-surface shadow-2xl flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-semibold text-text-primary m-0">
                  Memory Lineage History
                </h4>
                <button
                  type="button"
                  onClick={() => setActiveHistory(null)}
                  className="text-xs text-text-muted hover:text-text-primary"
                >
                  ✕
                </button>
              </div>
              <ul className="flex flex-col gap-2 max-h-60 overflow-y-auto text-xs">
                {activeHistory.chain.map((c) => (
                  <li
                    key={c.id}
                    className="p-2.5 rounded-lg border border-border bg-surface-elevated"
                  >
                    <div className="font-medium text-text-primary">{c.content}</div>
                    <div className="text-2xs text-text-muted font-mono mt-1">
                      {c.validTo ? `Valid until ${c.validTo}` : "Currently Active"}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Explain Modal */}
        {activeExplain && (
          // biome-ignore lint/a11y/useSemanticElements: overlay styled as fixed scrim, requires div with dialog role
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Recall scoring"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
          >
            <div className="w-full max-w-md p-5 rounded-xl border border-border bg-surface shadow-2xl flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-semibold text-text-primary m-0">
                  Recall Scoring & Lineage
                </h4>
                <button
                  type="button"
                  onClick={() => setActiveExplain(null)}
                  className="text-xs text-text-muted hover:text-text-primary"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">Confidence:</span>
                  <span className="font-semibold text-text-primary">
                    {activeExplain.confidence}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Effective Score:</span>
                  <span className="font-mono text-accent">
                    {activeExplain.effectiveConfidence?.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
