import { useEffect, useMemo, useRef, useState } from "react";
import { COCKPIT_TAB_GROUPS, getPanel } from "./panel-registry.js";

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
    <div className="flex flex-col flex-1 min-h-0 bg-surface border border-border rounded-xl overflow-hidden">
      <header className="flex items-start gap-4 px-5 py-4 border-b border-border shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="mt-1 text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← Back
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-lg font-semibold tracking-tight text-text-primary truncate">
            {title || id}
          </span>
          <span className="text-xs text-text-muted truncate" title={cwd}>
            {cwd}
          </span>
        </div>
      </header>

      <nav
        ref={navRef}
        aria-label="Cockpit panels"
        className="flex items-center gap-6 px-5 border-b border-border shrink-0"
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
                  "px-1 py-3 text-xs transition-colors duration-150 cursor-pointer",
                  "focus-visible:outline-2 focus-visible:outline-offset-2",
                  inGroup
                    ? "text-text-primary font-medium border-b-2 border-text-primary"
                    : "text-text-secondary hover:text-text-primary",
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

      <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {Body && <Body dir={dir} id={id} cwd={cwd} />}
      </main>
    </div>
  );
}
