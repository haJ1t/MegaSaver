import { useEffect, useMemo, useRef, useState } from "react";
import { COCKPIT_TAB_GROUPS, getPanel } from "./panel-registry.js";
import { SessionSaverStats } from "./panels/session-saver-stats.js";

export function SessionCockpit({
  dir,
  id,
  cwd,
  title,
  onBack,
}: {
  dir: string;
  id: string;
  cwd: string;
  title: string;
  onBack: () => void;
}): JSX.Element {
  const [activePanelId, setActivePanelId] = useState<string>("transcript");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const active = getPanel(activePanelId);
  const Body = active?.component;

  const activeGroupId = useMemo(
    () => COCKPIT_TAB_GROUPS.find((g) => g.panelIds.includes(activePanelId))?.id ?? null,
    [activePanelId],
  );

  useEffect(() => {
    if (!openGroup) return;
    const handlePointer = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenGroup(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openGroup]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="flex items-center gap-3.5 px-5 pt-4 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-xs cursor-pointer hover:bg-surface-elevated transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← Sessions
        </button>
        <div className="flex flex-col min-w-0">
          <h1 className="m-0 text-xl font-semibold tracking-tight truncate">{title || id}</h1>
          <span className="font-mono text-xs text-text-muted truncate" title={cwd}>
            {cwd}
          </span>
        </div>
      </header>

      <nav
        ref={navRef}
        aria-label="Cockpit panels"
        className="flex items-center gap-5 px-5 mt-3.5 border-b border-border shrink-0"
      >
        {COCKPIT_TAB_GROUPS.map((group) => {
          const inGroup = activeGroupId === group.id;
          const expanded = openGroup === group.id;
          const grouped = group.panelIds.length > 1;
          return (
            <div key={group.id} className="relative">
              <button
                type="button"
                aria-current={inGroup ? "page" : undefined}
                aria-expanded={grouped ? expanded : undefined}
                aria-haspopup={grouped ? "menu" : undefined}
                aria-controls={grouped && expanded ? `${group.id}-menu` : undefined}
                onClick={() => {
                  if (grouped) {
                    setOpenGroup(expanded ? null : group.id);
                  } else {
                    setActivePanelId(group.panelIds[0] ?? activePanelId);
                    setOpenGroup(null);
                  }
                }}
                className={[
                  "px-0.5 py-2.5 text-sm border-b-2 transition-colors duration-150 cursor-pointer",
                  "focus-visible:outline-2 focus-visible:outline-offset-2",
                  inGroup
                    ? "text-text-primary font-semibold border-accent"
                    : "text-text-secondary border-transparent hover:text-text-primary",
                ].join(" ")}
              >
                {group.label}
                {grouped && <span className="ml-0.5 text-[10px]">▾</span>}
              </button>
              {expanded && (
                <div
                  id={`${group.id}-menu`}
                  role="menu"
                  aria-label={`${group.label} panels`}
                  className="absolute top-full left-0 mt-1 py-1 bg-surface border border-border rounded-md shadow-sm min-w-[140px] z-10"
                >
                  {group.panelIds.map((pid) => {
                    const panel = getPanel(pid);
                    if (!panel) return null;
                    return (
                      <button
                        key={pid}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setActivePanelId(pid);
                          setOpenGroup(null);
                        }}
                        className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-elevated hover:text-text-primary focus-visible:bg-surface-elevated"
                      >
                        {panel.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex flex-1 min-h-0 overflow-hidden max-lg:flex-col">
        <main className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          {Body && <Body dir={dir} id={id} cwd={cwd} />}
        </main>
        <aside className="w-[288px] max-lg:w-full shrink-0 border-l max-lg:border-l-0 max-lg:border-t border-border bg-surface p-5 overflow-y-auto flex flex-col gap-6">
          <SessionSaverStats dir={dir} id={id} />
        </aside>
      </div>
    </div>
  );
}
