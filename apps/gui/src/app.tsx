import { useState } from "react";
import { SessionCockpit } from "./cockpit/session-cockpit.js";
import type { ClaudeSessionMeta } from "./lib/claude-sessions-client.js";
import { VIEW_LABELS, type ViewId } from "./view-id.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { WorkspaceSessionList } from "./views/workspace-session-list.js";

// Live-first shell: the grouped session home is the default surface; the
// global agent-setup view is the only other destination. No project state.
const NAV_VIEWS: readonly ViewId[] = ["claude-sessions", "agent-setup"];

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("claude-sessions");
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <header className="flex items-center gap-4 px-4 py-2 border-b border-border bg-surface shrink-0">
        <span className="text-sm font-medium text-text-primary tracking-tight select-none">
          Mega Saver
        </span>
        <nav aria-label="Main navigation" className="flex items-center gap-1">
          {NAV_VIEWS.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                setView(id);
                if (id !== "claude-sessions") setSelected(null);
              }}
              className={[
                "px-2.5 py-1 text-xs rounded-md transition-colors duration-150 cursor-pointer",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                view === id
                  ? "bg-accent/15 text-text-primary font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
              ].join(" ")}
            >
              {VIEW_LABELS[id]}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {view === "agent-setup" ? (
          <AgentSetupDoctor activeProjectId={null} />
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
      </main>
    </div>
  );
}
