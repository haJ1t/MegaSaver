import { useEffect, useState } from "react";
import { SessionCockpit } from "./cockpit/session-cockpit.js";
import { Sidebar } from "./components/sidebar.js";
import { type ClaudeSessionMeta, fetchClaudeSessions } from "./lib/claude-sessions-client.js";
import { type WorkspaceOption, deriveWorkspaceOptions } from "./lib/workspace-context.js";
import type { ViewId } from "./view-id.js";
import { AgentOfficeView } from "./views/agent-office-view.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { MemoryPage } from "./views/memory-page.js";
import { TokenSaverPage } from "./views/token-saver-page.js";
import { WorkspacePage } from "./views/workspace-page.js";
import { WorkspaceSessionList } from "./views/workspace-session-list.js";

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("sessions");
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Derive the workspace options once for the picker-backed pages.
  useEffect(() => {
    let live = true;
    fetchClaudeSessions(50, 0)
      .then((list) => {
        if (!live) return;
        const opts = deriveWorkspaceOptions(list);
        setWorkspaces(opts);
        setActiveKey((k) => k ?? opts[0]?.key ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const navigate = (next: ViewId): void => {
    setView(next);
    if (next !== "sessions") setSelected(null);
  };

  return (
    <div className="flex min-h-screen bg-background text-text-primary font-sans">
      <Sidebar active={view} onNavigate={navigate} />
      <main className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <div data-testid="page-container" className="flex flex-col flex-1 min-h-0 w-full">
          {view === "agent-setup" ? (
            <AgentSetupDoctor />
          ) : view === "agent-office" ? (
            <AgentOfficeView />
          ) : view === "token-saver" ? (
            <TokenSaverPage
              options={workspaces}
              activeKey={activeKey}
              onWorkspaceChange={setActiveKey}
            />
          ) : view === "memory" ? (
            <MemoryPage
              options={workspaces}
              activeKey={activeKey}
              onWorkspaceChange={setActiveKey}
            />
          ) : view === "workspace" ? (
            <WorkspacePage
              options={workspaces}
              activeKey={activeKey}
              onWorkspaceChange={setActiveKey}
            />
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
