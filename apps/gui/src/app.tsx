import type { Project } from "@megasaver/core";
import { useEffect, useState } from "react";
import { ProjectPicker, readPersistedProjectId } from "./components/project-picker.js";
import { ErrorState, LoadingState, NoProjectState } from "./components/states.js";
import type { BridgeError } from "./components/states.js";
import { fetchProjects } from "./lib/api-client.js";
import { VIEW_IDS, VIEW_LABELS, type ViewId } from "./view-id.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { MemoryView } from "./views/memory-view.js";
import { SessionsView } from "./views/sessions-view.js";

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("sessions");

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "error">("loading");
  const [projectsError, setProjectsError] = useState<BridgeError | null>(null);

  // Active project: restore from localStorage, validate against loaded list.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Deep-link: when memory screen clicks "View session", switch view + pass id.
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  // Load projects on mount.
  useEffect(() => {
    let cancelled = false;
    setProjectsState("loading");
    fetchProjects()
      .then((list) => {
        if (cancelled) return;
        // Sort by createdAt ascending (spec §4).
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setProjects(list);
        setProjectsState("ready");

        // Restore persisted project, validating it still exists (spec §3b).
        const persisted = readPersistedProjectId();
        const valid = persisted && list.some((p) => p.id === persisted);
        setActiveProjectId(valid ? persisted : null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProjectsError(err as BridgeError);
        setProjectsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When user navigates from memory detail to view session deep link.
  function handleViewSession(sessionId: string): void {
    setPendingSessionId(sessionId);
    setView("sessions");
  }

  function retryProjects(): void {
    setProjectsState("loading");
    setProjectsError(null);
    fetchProjects()
      .then((list) => {
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setProjects(list);
        setProjectsState("ready");
        const persisted = readPersistedProjectId();
        const valid = persisted && list.some((p) => p.id === persisted);
        setActiveProjectId(valid ? persisted : null);
      })
      .catch((err: unknown) => {
        setProjectsError(err as BridgeError);
        setProjectsState("error");
      });
  }

  const showProjectsLoading = projectsState === "loading";
  const showProjectsError = projectsState === "error";
  const showNoProjects = projectsState === "ready" && projects.length === 0;
  const showNoSelection = projectsState === "ready" && projects.length > 0 && !activeProjectId;
  const showContent = projectsState === "ready" && !!activeProjectId;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Top chrome */}
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-border bg-surface shrink-0">
        {/* Brand + project picker */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-text-primary tracking-tight select-none">
            Mega Saver
          </span>
          {projectsState === "ready" && (
            <ProjectPicker
              projects={projects}
              activeId={activeProjectId}
              onSelect={setActiveProjectId}
            />
          )}
        </div>

        {/* View switcher (spec §3e — preserve AA3 alphabetic order from ViewId) */}
        <nav aria-label="Main navigation">
          <ul className="flex gap-1">
            {VIEW_IDS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={view === id ? "page" : undefined}
                  onClick={() => setView(id)}
                  className={[
                    "px-3 py-1 text-xs rounded-md transition-colors duration-150 cursor-pointer",
                    "focus-visible:outline-2 focus-visible:outline-offset-2",
                    view === id
                      ? "bg-accent/15 text-accent font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
                  ].join(" ")}
                >
                  {VIEW_LABELS[id]}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {view === "agent-setup" ? (
          // Agent setup loads status regardless of project; install/repair
          // actions gate themselves on a selected project (spec §7).
          <AgentSetupDoctor activeProjectId={activeProjectId} />
        ) : (
          <>
            {showProjectsLoading && <LoadingState label="Connecting to bridge…" />}

            {showProjectsError && projectsError && (
              <ErrorState error={projectsError} onRetry={retryProjects} />
            )}

            {showNoProjects && <NoProjectState />}

            {showNoSelection && (
              <div className="px-4 py-8 text-sm text-text-muted">Pick a project to begin.</div>
            )}

            {showContent && (
              <>
                {view === "sessions" && (
                  <SessionsView
                    projectId={activeProjectId as string}
                    initialSelectedId={pendingSessionId}
                    onClearInitialId={() => setPendingSessionId(null)}
                  />
                )}
                {view === "memory" && (
                  <MemoryView
                    projectId={activeProjectId as string}
                    onViewSession={handleViewSession}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
