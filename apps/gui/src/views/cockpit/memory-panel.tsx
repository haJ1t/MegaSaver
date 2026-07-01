import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type OverlayMemoryEntry,
  createSessionMemory,
  deleteSessionMemory,
  fetchSessionMemory,
} from "../../lib/claude-sessions-client.js";

export function MemoryPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [rows, setRows] = useState<OverlayMemoryEntry[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"session" | "project">("session");
  const [refreshNonce, setRefreshNonce] = useState(0);

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

  return (
    <section
      aria-label="Session memory"
      className="flex flex-col gap-3 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Memory</h2>

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
