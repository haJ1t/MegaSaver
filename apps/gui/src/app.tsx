import { useState } from "react";
import { SessionCockpit } from "./cockpit/session-cockpit.js";
import type { ClaudeSessionMeta } from "./lib/claude-sessions-client.js";
import { VIEW_LABELS, type ViewId } from "./view-id.js";
import { AgentOfficeView } from "./views/agent-office-view.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { WorkspaceSessionList } from "./views/workspace-session-list.js";

// Live-first shell: the grouped session home is the default surface; the
// global agent-setup view is the only other destination. No project state.
const NAV_VIEWS: readonly ViewId[] = ["claude-sessions", "agent-office", "agent-setup"];

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("claude-sessions");
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);

  return (
    <div className="flex flex-col min-h-screen bg-background text-text-primary font-sans">
      <header className="pt-6 pb-4 px-6 shrink-0">
        <div className="max-w-5xl mx-auto flex items-center gap-6">
          <span className="text-base font-semibold tracking-tight select-none">Mega Saver</span>
          <nav aria-label="Main navigation" className="flex items-center gap-1">
            {NAV_VIEWS.map((id) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setView(id);
                    if (id !== "claude-sessions") setSelected(null);
                  }}
                  className={[
                    "px-3 py-1.5 text-xs rounded-md transition-colors duration-150 cursor-pointer",
                    "focus-visible:outline-2 focus-visible:outline-offset-2",
                    active
                      ? "bg-text-primary text-surface font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
                  ].join(" ")}
                >
                  {VIEW_LABELS[id]}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex flex-col flex-1 px-6 pb-8 min-h-0">
        <div
          data-testid="page-container"
          className="flex flex-col flex-1 min-h-0 w-full max-w-5xl mx-auto"
        >
          {view === "agent-setup" ? (
            <AgentSetupDoctor />
          ) : view === "agent-office" ? (
            <AgentOfficeView />
          ) : selected ? (
            <SessionCockpit
              dir={selected.dir}
              id={selected.id}
              cwd={selected.projectLabel}
              title={selected.title}
              onBack={() => setSelected(null)}
            />
          ) : (
            <WorkspaceSessionList onSelect={setSelected} />
          )}
        </div>
      </main>
    </div>
  );
}
