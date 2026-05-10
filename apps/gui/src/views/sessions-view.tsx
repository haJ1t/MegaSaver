import type { Session } from "@megasaver/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentBadge, RiskBadge, StatusBadge } from "../components/badges.js";
import { CreateSessionForm, UpdateSessionForm } from "../components/session-forms.js";
import { EmptyState, ErrorState, LoadingState, NoSelectionState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { createSession, endSession, fetchSessions, updateSession } from "../lib/api-client.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

type SessionDetailFieldProps = { label: string; children: React.ReactNode };
function Field({ label, children }: SessionDetailFieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-muted uppercase tracking-widest">{label}</dt>
      <dd className="text-sm text-text-primary break-all">{children}</dd>
    </div>
  );
}

// ── SessionsView ──────────────────────────────────────────────────────────────

type SessionsViewProps = {
  projectId: string;
  // Allow the memory screen to navigate here with a pre-selected session.
  initialSelectedId?: string | null;
  onClearInitialId?: () => void;
};

export function SessionsView({
  projectId,
  initialSelectedId,
  onClearInitialId,
}: SessionsViewProps): JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<BridgeError | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endError, setEndError] = useState<BridgeError | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const data = await fetchSessions(projectId);
      // Newest startedAt first (spec §3c).
      data.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      setSessions(data);
      setLoadState("ready");
    } catch (err) {
      setLoadError(err as BridgeError);
      setLoadState("error");
    }
  }, [projectId]);

  // Initial load + when projectId changes.
  useEffect(() => {
    void load();
    setSelectedId(null);
    setShowCreateForm(false);
    setShowUpdateForm(false);
  }, [load]);

  // Honour deep-link from memory screen.
  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
      onClearInitialId?.();
    }
  }, [initialSelectedId, onClearInitialId]);

  // Focus error region when it appears (spec §9 item 8).
  useEffect(() => {
    if (endError) errorRef.current?.focus();
  }, [endError]);

  // Keyboard: Esc clears selection, arrow keys move selection.
  function handleListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setSelectedId(null);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = sessions.findIndex((s) => s.id === selectedId);
      const next =
        e.key === "ArrowDown" ? Math.min(idx + 1, sessions.length - 1) : Math.max(idx - 1, 0);
      setSelectedId(sessions[next]?.id ?? null);
    }
  }

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  // ── End session handler ───────────────────────────────────────────────────

  async function handleEnd(sessionId: string) {
    setEndingId(sessionId);
    setEndError(null);
    try {
      const updated = await endSession(sessionId);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setEndError(err as BridgeError);
    } finally {
      setEndingId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Left pane: list ── */}
      <div className="flex flex-col w-80 shrink-0 border-r border-border overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          {loadState === "ready" && (
            <span className="text-xs text-text-muted">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </span>
          )}
          {loadState !== "ready" && <span />}
          <button
            type="button"
            onClick={() => {
              setShowCreateForm((v) => !v);
              setShowUpdateForm(false);
            }}
            aria-label="Create new session"
            className={[
              "px-3 py-1 text-xs rounded-md",
              showCreateForm
                ? "bg-accent/20 text-accent border border-accent/30"
                : "bg-accent text-accent-fg",
              "cursor-pointer hover:opacity-90 transition-opacity duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
            ].join(" ")}
          >
            + New session
          </button>
        </div>

        {/* Create form (inline, above list) */}
        {showCreateForm && (
          <CreateSessionForm
            projectId={projectId}
            onCreated={(session) => {
              setSessions((prev) =>
                [session, ...prev].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
              );
              setSelectedId(session.id);
              setShowCreateForm(false);
            }}
            onCancel={() => setShowCreateForm(false)}
            onCreate={createSession}
          />
        )}

        {/* List */}
        {loadState === "loading" && <LoadingState label="Loading sessions…" />}
        {loadState === "error" && loadError && <ErrorState error={loadError} onRetry={load} />}
        {loadState === "ready" && sessions.length === 0 && (
          <EmptyState title="No sessions yet." description="Create one with the button above." />
        )}
        {loadState === "ready" && sessions.length > 0 && (
          <div
            ref={listRef}
            role="listbox"
            aria-label="Sessions list"
            tabIndex={0}
            onKeyDown={handleListKeyDown}
            className="flex flex-col overflow-y-auto flex-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          >
            {sessions.map((session) => {
              const isSelected = session.id === selectedId;
              const status: "open" | "ended" = session.endedAt === null ? "open" : "ended";
              return (
                <div
                  key={session.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => {
                    setSelectedId(session.id);
                    setShowUpdateForm(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(session.id);
                      setShowUpdateForm(false);
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
                    <span className="text-xs text-text-muted font-mono">
                      {shortId(session.id)}…
                    </span>
                    <StatusBadge status={status} />
                  </div>
                  <p className="text-sm text-text-primary truncate">
                    {session.title ?? <span className="text-text-muted italic">untitled</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    <AgentBadge agentId={session.agentId} />
                    <RiskBadge level={session.riskLevel} />
                    <span className="text-xs text-text-muted ml-auto">
                      {formatDate(session.startedAt)}
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
        {!selected && <NoSelectionState entity="session" />}

        {selected && (
          <>
            {/* Header row */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-medium text-text-primary">
                  {selected.title ?? (
                    <span className="text-text-muted italic">Untitled session</span>
                  )}
                </h2>
                <p className="text-xs text-text-muted mt-1 font-mono">{selected.id}</p>
              </div>
              <StatusBadge status={selected.endedAt === null ? "open" : "ended"} />
            </div>

            {/* Metadata grid */}
            {!showUpdateForm && (
              <dl className="grid grid-cols-2 gap-x-8 gap-y-4 mb-6">
                <Field label="Agent">
                  <AgentBadge agentId={selected.agentId} />
                </Field>
                <Field label="Risk">
                  <RiskBadge level={selected.riskLevel} />
                </Field>
                <Field label="Project">{shortId(selected.projectId)}…</Field>
                <Field label="Started">{formatDate(selected.startedAt)}</Field>
                <Field label="Ended">{selected.endedAt ? formatDate(selected.endedAt) : "—"}</Field>
              </dl>
            )}

            {/* Bridge error for end action */}
            {endError && (
              <div ref={errorRef} tabIndex={-1}>
                <ErrorState error={endError} onRetry={() => setEndError(null)} />
              </div>
            )}

            {/* Action buttons — visible when not in update form, not ended */}
            {!showUpdateForm && selected.endedAt === null && (
              <div className="flex gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => setShowUpdateForm(true)}
                  className={[
                    "px-4 py-1.5 text-sm rounded-md",
                    "border border-border text-text-secondary",
                    "cursor-pointer hover:text-text-primary transition-colors duration-150",
                    "focus-visible:outline-2 focus-visible:outline-offset-2",
                  ].join(" ")}
                >
                  Update
                </button>
                <button
                  type="button"
                  onClick={() => void handleEnd(selected.id)}
                  disabled={endingId === selected.id}
                  className={[
                    "px-4 py-1.5 text-sm rounded-md",
                    "border border-danger/40 text-danger",
                    "cursor-pointer hover:bg-danger/5 transition-colors duration-150",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "focus-visible:outline-2 focus-visible:outline-offset-2",
                  ].join(" ")}
                >
                  {endingId === selected.id ? "Ending…" : "End session"}
                </button>
              </div>
            )}

            {/* Update form (inline, inside detail pane) */}
            {showUpdateForm && selected.endedAt === null && (
              <UpdateSessionForm
                session={selected}
                onUpdated={(updated) => {
                  setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
                  setSelectedId(updated.id);
                  setShowUpdateForm(false);
                }}
                onCancel={() => setShowUpdateForm(false)}
                onUpdate={updateSession}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
