import type { MemoryEntry, Session } from "@megasaver/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScopeBadge } from "../components/badges.js";
import { CreateMemoryForm } from "../components/memory-forms.js";
import { EmptyState, ErrorState, LoadingState, NoSelectionState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import {
  createMemoryEntry,
  deleteMemoryEntry,
  fetchMemory,
  fetchSessions,
  updateMemoryEntry,
} from "../lib/api-client.js";
import { shortId } from "../lib/short-id.js";

const APPROVAL_CLASS: Record<"approved" | "rejected" | "suggested", string> = {
  approved: "bg-ok/15 text-ok",
  rejected: "bg-danger/15 text-danger",
  suggested: "bg-warn/15 text-warn",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PREVIEW_MAX = 80;
function preview(content: string): string {
  if (content.length <= PREVIEW_MAX) return content;
  return `${content.slice(0, PREVIEW_MAX)}…`;
}

type FieldProps = { label: string; children: React.ReactNode };
function Field({ label, children }: FieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-muted uppercase tracking-widest">{label}</dt>
      <dd className="text-sm text-text-primary break-all">{children}</dd>
    </div>
  );
}

// ── MemoryView ────────────────────────────────────────────────────────────────

type MemoryViewProps = {
  projectId: string;
  // Called when user clicks "View session" on a linked session.
  onViewSession: (sessionId: string) => void;
};

export function MemoryView({ projectId, onViewSession }: MemoryViewProps): JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<BridgeError | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [mutating, setMutating] = useState(false);
  const [mutateError, setMutateError] = useState<BridgeError | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const [entriesData, sessionsData] = await Promise.all([
        fetchMemory(projectId, appliedSearch.trim() ? { query: appliedSearch } : {}),
        fetchSessions(projectId),
      ]);
      // Newest createdAt first (spec §4).
      entriesData.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setEntries(entriesData);
      setSessions(sessionsData);
      setLoadState("ready");
    } catch (err) {
      setLoadError(err as BridgeError);
      setLoadState("error");
    }
  }, [projectId, appliedSearch]);

  async function mutateApproval(id: string, approval: "approved" | "rejected"): Promise<void> {
    setMutating(true);
    setMutateError(null);
    try {
      const updated = await updateMemoryEntry(id, { approval });
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setMutateError(err as BridgeError);
    } finally {
      setMutating(false);
    }
  }

  async function removeEntry(id: string): Promise<void> {
    setMutating(true);
    setMutateError(null);
    try {
      await deleteMemoryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setSelectedId(null);
    } catch (err) {
      setMutateError(err as BridgeError);
    } finally {
      setMutating(false);
    }
  }

  useEffect(() => {
    void load();
    setSelectedId(null);
    setShowCreateForm(false);
  }, [load]);

  // Keyboard: Esc clears selection, arrow keys move through list.
  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setSelectedId(null);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = entries.findIndex((en) => en.id === selectedId);
      const next =
        e.key === "ArrowDown" ? Math.min(idx + 1, entries.length - 1) : Math.max(idx - 1, 0);
      setSelectedId(entries[next]?.id ?? null);
    }
  }

  const selected = entries.find((en) => en.id === selectedId) ?? null;
  const linkedSession =
    selected?.sessionId != null ? sessions.find((s) => s.id === selected.sessionId) : null;

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Left pane: list ── */}
      <div className="flex flex-col w-80 shrink-0 border-r border-border overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          {loadState === "ready" && (
            <span className="text-xs text-text-muted">
              {entries.length} {entries.length !== 1 ? "entries" : "entry"}
            </span>
          )}
          {loadState !== "ready" && <span />}
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            aria-label="Create new memory entry"
            className={[
              "px-3 py-1 text-xs rounded-md",
              showCreateForm
                ? "bg-accent/20 text-text-primary border border-accent/30"
                : "bg-accent text-accent-fg",
              "cursor-pointer hover:opacity-90 transition-opacity duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
            ].join(" ")}
          >
            + New entry
          </button>
        </div>

        {/* Search */}
        <form
          className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(search);
          }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memory…"
            aria-label="Search memory entries"
            className="flex-1 px-2 py-1 text-xs bg-surface-elevated border border-border rounded-md text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          <button
            type="submit"
            className="px-2 py-1 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary cursor-pointer"
          >
            Search
          </button>
        </form>

        {/* Create form (inline, above list) */}
        {showCreateForm && (
          <CreateMemoryForm
            projectId={projectId}
            sessions={sessions}
            onCreated={(entry) => {
              setEntries((prev) =>
                [entry, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
              );
              setSelectedId(entry.id);
              setShowCreateForm(false);
            }}
            onCancel={() => setShowCreateForm(false)}
            onCreate={createMemoryEntry}
          />
        )}

        {/* List body */}
        {loadState === "loading" && <LoadingState label="Loading memory entries…" />}
        {loadState === "error" && loadError && <ErrorState error={loadError} onRetry={load} />}
        {loadState === "ready" && entries.length === 0 && (
          <EmptyState
            title="No memory entries yet."
            description="Create one with the button above."
          />
        )}
        {loadState === "ready" && entries.length > 0 && (
          <div
            ref={listRef}
            role="listbox"
            aria-label="Memory entries list"
            tabIndex={0}
            onKeyDown={handleListKeyDown}
            className="flex flex-col overflow-y-auto flex-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          >
            {entries.map((entry) => {
              const isSelected = entry.id === selectedId;
              return (
                <div
                  key={entry.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => {
                    setSelectedId(entry.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(entry.id);
                    }
                  }}
                  className={[
                    "flex flex-col gap-1 px-4 py-3 cursor-pointer",
                    "border-b border-border",
                    "transition-colors duration-100",
                    isSelected ? "bg-accent/10 border-b-accent/20" : "hover:bg-surface-elevated",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted font-mono">{shortId(entry.id)}…</span>
                    <ScopeBadge scope={entry.scope} />
                  </div>
                  <p className="text-xs text-text-secondary truncate leading-relaxed">
                    {preview(entry.content)}
                  </p>
                  <div className="flex items-center justify-between">
                    {entry.sessionId && (
                      <span className="text-xs text-text-muted font-mono truncate max-w-[100px]">
                        ↳ {shortId(entry.sessionId)}…
                      </span>
                    )}
                    <span className="text-xs text-text-muted ml-auto">
                      {formatDate(entry.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right pane: detail ── */}
      <div className="flex flex-col flex-1 overflow-y-auto px-6 py-4 min-w-0">
        {!selected && <NoSelectionState entity="memory entry" />}

        {selected && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-sm text-text-muted uppercase tracking-widest">Memory entry</h2>
                <p className="text-xs text-text-muted mt-1 font-mono">{selected.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 text-xs rounded-sm ${APPROVAL_CLASS[selected.approval]}`}
                >
                  {selected.approval}
                </span>
                <ScopeBadge scope={selected.scope} />
              </div>
            </div>

            {/* Content block — full, no truncation (spec §3d), monospace */}
            <div className="mb-6">
              <dt className="text-xs text-text-muted uppercase tracking-widest mb-2">Content</dt>
              <pre
                className={[
                  "p-4 text-sm text-text-primary leading-relaxed",
                  "bg-surface-elevated rounded-md border border-border",
                  "whitespace-pre-wrap break-words font-mono overflow-x-auto",
                ].join(" ")}
              >
                {selected.content}
              </pre>
            </div>

            {/* Metadata */}
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 mb-6">
              <Field label="Scope">
                <ScopeBadge scope={selected.scope} />
              </Field>
              <Field label="Created">{formatDate(selected.createdAt)}</Field>
              <Field label="Project">{shortId(selected.projectId)}…</Field>
              <Field label="Session">
                {selected.sessionId ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Deep-link: switch to Sessions screen and select this session.
                      // spec §3d: "clicking switches to the Sessions screen and selects that row"
                      onViewSession(selected.sessionId as string);
                    }}
                    className="text-accent hover:underline text-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
                    aria-label={`View linked session ${shortId(selected.sessionId)}`}
                  >
                    {linkedSession
                      ? (linkedSession.title ?? shortId(selected.sessionId))
                      : `${shortId(selected.sessionId)}…`}
                    {" ↗"}
                  </button>
                ) : (
                  "—"
                )}
              </Field>
            </dl>

            {/* HITL + delete actions (P0). */}
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                disabled={mutating || selected.approval === "approved"}
                onClick={() => void mutateApproval(selected.id, "approved")}
                className="px-3 py-1 text-xs rounded-md bg-ok/15 text-ok cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={mutating || selected.approval === "rejected"}
                onClick={() => void mutateApproval(selected.id, "rejected")}
                className="px-3 py-1 text-xs rounded-md bg-warn/15 text-warn cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={() => {
                  if (window.confirm("Delete this memory entry? This cannot be undone.")) {
                    void removeEntry(selected.id);
                  }
                }}
                className="ml-auto px-3 py-1 text-xs rounded-md border border-danger/30 text-danger cursor-pointer hover:bg-danger/5 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Delete
              </button>
            </div>
            {mutateError && <ErrorState error={mutateError} />}
          </>
        )}
      </div>
    </div>
  );
}
