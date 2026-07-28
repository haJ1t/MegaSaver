import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionCockpit } from "./cockpit/session-cockpit.js";
import { type Command, CommandPalette } from "./components/command-palette.js";
import { Sidebar } from "./components/sidebar.js";
import { Toast, useToast } from "./components/toast.js";
import { TopBar } from "./components/top-bar.js";
import { fetchMcpStatus } from "./lib/api-client.js";
import { type ClaudeSessionMeta, fetchClaudeSessions } from "./lib/claude-sessions-client.js";
import { countLive } from "./lib/session-liveness.js";
import { type WorkspaceOption, deriveWorkspaceOptions } from "./lib/workspace-context.js";
import { VIEW_LABELS, type ViewId } from "./view-id.js";
import { AgentOfficeView } from "./views/agent-office-view.js";
import { AgentSetupDoctor } from "./views/agent-setup-doctor.js";
import { MemoryPage } from "./views/memory-page.js";
import { OverviewPage } from "./views/overview-page.js";
import { TokenSaverPage } from "./views/token-saver-page.js";
import { WorkspacePage } from "./views/workspace-page.js";
import { WorkspaceSessionList } from "./views/workspace-session-list.js";

const PALETTE_VIEWS: ReadonlyArray<{ id: ViewId; icon: string }> = [
  { id: "overview", icon: "◈" },
  { id: "sessions", icon: "▤" },
  { id: "token-saver", icon: "↯" },
  { id: "memory", icon: "◍" },
  { id: "workspace", icon: "▧" },
  { id: "agent-office", icon: "⬡" },
  { id: "agent-setup", icon: "⚙" },
];

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("overview");
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const toast = useToast();

  // Derive the workspace options for the picker-backed pages, polling so the
  // picker self-heals from a transient mount-time fetch failure.
  useEffect(() => {
    let live = true;
    const tick = (): void => {
      fetchClaudeSessions(50, 0)
        .then((list) => {
          if (!live) return;
          setSessions(list);
          const opts = deriveWorkspaceOptions(list);
          setWorkspaces(opts);
          setActiveKey((k) => k ?? opts[0]?.key ?? null);
        })
        .catch(() => {});
      // Outside the .then, matching OverviewPage: if this only advanced on a
      // successful fetch, an outage would freeze the live count at its last
      // value while Overview's list correctly emptied.
      if (live) setNowMs(Date.now());
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // Drives the sidebar attention dot on Setup. Polled, not once-at-mount, so
  // the dot clears after the user installs MCP on the Setup page.
  useEffect(() => {
    let live = true;
    const tick = (): void => {
      void fetchMcpStatus()
        .then((s) => {
          // Same boundary caveat as OverviewPage: guard the shape, not just null.
          if (live && Array.isArray(s?.agents))
            setNeedsSetup(s.agents.some((a) => !a.mcpInstalled));
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  // Stable identities: the palette's command list memoises on them.
  const navigate = useCallback((next: ViewId): void => {
    setView(next);
    setSelected(null);
  }, []);

  const openSession = useCallback((session: ClaudeSessionMeta): void => {
    setView("sessions");
    setSelected(session);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const views: Command[] = PALETTE_VIEWS.map((v) => ({
      id: `view:${v.id}`,
      label: VIEW_LABELS[v.id],
      hint: "view",
      icon: v.icon,
      run: () => navigate(v.id),
    }));
    const sessionCommands: Command[] = sessions.map((s) => ({
      id: `session:${s.dir}/${s.id}`,
      label: s.title,
      hint: s.projectLabel,
      icon: "›",
      run: () => openSession(s),
    }));
    return [...views, ...sessionCommands];
  }, [sessions, navigate, openSession]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-text-primary font-sans">
      <Sidebar
        active={view}
        onNavigate={navigate}
        sessionCount={sessions.length}
        needsSetup={needsSetup}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar
          options={workspaces}
          activeKey={activeKey}
          onWorkspaceChange={(k) => {
            setActiveKey(k);
            const label = workspaces.find((w) => w.key === k)?.label;
            if (label) toast.say(`Switched to ${label}.`);
          }}
          liveCount={countLive(sessions, nowMs)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div data-testid="page-container" className="flex flex-col min-h-0 w-full">
            {view === "overview" ? (
              <OverviewPage
                options={workspaces}
                activeKey={activeKey}
                onNavigate={navigate}
                onOpenSession={openSession}
              />
            ) : view === "agent-setup" ? (
              <AgentSetupDoctor />
            ) : view === "agent-office" ? (
              <AgentOfficeView />
            ) : view === "token-saver" ? (
              <TokenSaverPage options={workspaces} activeKey={activeKey} />
            ) : view === "memory" ? (
              <MemoryPage options={workspaces} activeKey={activeKey} />
            ) : view === "workspace" ? (
              <WorkspacePage options={workspaces} activeKey={activeKey} />
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
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}
      <Toast message={toast.message} />
    </div>
  );
}
