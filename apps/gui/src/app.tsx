import type { Project } from "@megasaver/core";
import { useEffect, useState } from "react";
import { ProjectCreateForm } from "./components/project-create-form.js";
import { ProjectPicker, readPersistedProjectId } from "./components/project-picker.js";
import { ErrorState, LoadingState, NoProjectState } from "./components/states.js";
import type { BridgeError } from "./components/states.js";
import { fetchProjects } from "./lib/api-client.js";
import { PROJECT_SCOPED_VIEWS, VIEW_LABELS, type ViewId } from "./view-id.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { ContextView } from "./views/context-view.js";
import { IndexView } from "./views/index-view.js";
import { MemoryView } from "./views/memory-view.js";
import { OverviewView } from "./views/overview-view.js";
import { RulesView } from "./views/rules-view.js";
import { SessionsView } from "./views/sessions-view.js";
import { TasksView } from "./views/tasks-view.js";
import { ToolsView } from "./views/tools-view.js";

// Sidebar groups. Order is logical (not the enum's alphabetic pin): the project
// workspace first, global tools below.
const NAV_GROUPS: ReadonlyArray<{ heading: string; views: readonly ViewId[] }> = [
  {
    heading: "Workspace",
    views: ["overview", "sessions", "memory", "rules", "index", "context", "tasks", "tools"],
  },
  { heading: "Tools", views: ["agent-setup"] },
];

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("overview");

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "error">("loading");
  const [projectsError, setProjectsError] = useState<BridgeError | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  function applyProjects(list: Project[]): void {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setProjects(list);
    setProjectsState("ready");
    const persisted = readPersistedProjectId();
    const valid = persisted && list.some((p) => p.id === persisted);
    setActiveProjectId(valid ? persisted : null);
  }

  function loadProjects(): void {
    setProjectsState("loading");
    setProjectsError(null);
    fetchProjects()
      .then(applyProjects)
      .catch((err: unknown) => {
        setProjectsError(err as BridgeError);
        setProjectsState("error");
      });
  }

  useEffect(() => {
    let cancelled = false;
    setProjectsState("loading");
    fetchProjects()
      .then((list) => {
        if (cancelled) return;
        // Inlined (not applyProjects) so the mount effect has no outer-fn dep.
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setProjects(list);
        setProjectsState("ready");
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

  function handleViewSession(sessionId: string): void {
    setPendingSessionId(sessionId);
    setView("sessions");
  }

  function handleProjectCreated(project: Project): void {
    setProjects((prev) =>
      [...prev, project].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    setActiveProjectId(project.id);
    setView("overview");
  }

  const isProjectScoped = PROJECT_SCOPED_VIEWS.has(view);
  const showProjectsLoading = projectsState === "loading";
  const showProjectsError = projectsState === "error";
  const showNoProjects = projectsState === "ready" && projects.length === 0;
  const showNoSelection =
    projectsState === "ready" && projects.length > 0 && !activeProjectId && isProjectScoped;
  const showContent = projectsState === "ready" && !!activeProjectId;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-border bg-surface shrink-0">
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
          {projectsState === "ready" && <ProjectCreateForm onCreated={handleProjectCreated} />}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar nav */}
        <nav
          aria-label="Main navigation"
          className="flex flex-col gap-4 w-44 shrink-0 border-r border-border bg-surface px-2 py-3 overflow-y-auto"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="flex flex-col gap-0.5">
              <span className="px-2 text-xs text-text-muted uppercase tracking-widest">
                {group.heading}
              </span>
              {group.views.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-current={view === id ? "page" : undefined}
                  onClick={() => setView(id)}
                  className={[
                    "px-2 py-1 text-xs rounded-md text-left transition-colors duration-150 cursor-pointer",
                    "focus-visible:outline-2 focus-visible:outline-offset-2",
                    view === id
                      ? "bg-accent/15 text-text-primary font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
                  ].join(" ")}
                >
                  {VIEW_LABELS[id]}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {view === "agent-setup" ? (
            <AgentSetupDoctor activeProjectId={activeProjectId} />
          ) : (
            <>
              {showProjectsLoading && <LoadingState label="Connecting to bridge…" />}
              {showProjectsError && projectsError && (
                <ErrorState error={projectsError} onRetry={loadProjects} />
              )}
              {showNoProjects && <NoProjectState />}
              {showNoSelection && (
                <div className="px-4 py-8 text-sm text-text-muted">Pick a project to begin.</div>
              )}
              {showContent && (
                <ActiveView
                  view={view}
                  projectId={activeProjectId as string}
                  pendingSessionId={pendingSessionId}
                  onClearPending={() => setPendingSessionId(null)}
                  onViewSession={handleViewSession}
                  onNavigate={setView}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function ActiveView({
  view,
  projectId,
  pendingSessionId,
  onClearPending,
  onViewSession,
  onNavigate,
}: {
  view: ViewId;
  projectId: string;
  pendingSessionId: string | null;
  onClearPending: () => void;
  onViewSession: (sessionId: string) => void;
  onNavigate: (view: ViewId) => void;
}): JSX.Element | null {
  switch (view) {
    case "overview":
      return <OverviewView projectId={projectId} onNavigate={onNavigate} />;
    case "sessions":
      return (
        <SessionsView
          projectId={projectId}
          initialSelectedId={pendingSessionId}
          onClearInitialId={onClearPending}
        />
      );
    case "memory":
      return <MemoryView projectId={projectId} onViewSession={onViewSession} />;
    case "rules":
      return <RulesView projectId={projectId} />;
    case "index":
      return <IndexView projectId={projectId} />;
    case "context":
      return <ContextView projectId={projectId} />;
    case "tasks":
      return <TasksView projectId={projectId} />;
    case "tools":
      return <ToolsView projectId={projectId} />;
    default:
      return null;
  }
}
