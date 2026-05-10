import type { Session } from "@megasaver/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { CreateSessionForm } from "../components/session-forms.js";
import { EmptyState, ErrorState, LoadingState, NoSelectionState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { createSession, endSession, fetchSessions } from "../lib/api-client.js";
import { SessionsDetail } from "./sessions-detail.js";
import { SessionsList } from "./sessions-list.js";

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

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex flex-col w-80 shrink-0 border-r border-border overflow-hidden">
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

        {loadState === "loading" && <LoadingState label="Loading sessions…" />}
        {loadState === "error" && loadError && <ErrorState error={loadError} onRetry={load} />}
        {loadState === "ready" && sessions.length === 0 && (
          <EmptyState title="No sessions yet." description="Create one with the button above." />
        )}
        {loadState === "ready" && sessions.length > 0 && (
          <SessionsList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setShowUpdateForm(false);
            }}
            listRef={listRef}
            onKeyDown={handleListKeyDown}
          />
        )}
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto px-6 py-4 min-w-0">
        {!selected && <NoSelectionState entity="session" />}
        {selected && (
          <SessionsDetail
            selected={selected}
            endError={endError}
            errorRef={errorRef}
            onClearEndError={() => setEndError(null)}
            showUpdateForm={showUpdateForm}
            onShowUpdateForm={() => setShowUpdateForm(true)}
            onHideUpdateForm={() => setShowUpdateForm(false)}
            onUpdated={(updated) => {
              setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
              setSelectedId(updated.id);
              setShowUpdateForm(false);
            }}
            endingId={endingId}
            onEnd={(id) => void handleEnd(id)}
          />
        )}
      </div>
    </div>
  );
}
