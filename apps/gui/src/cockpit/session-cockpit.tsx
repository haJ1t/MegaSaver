import { useState } from "react";
import { COCKPIT_PANELS, getPanel } from "./panel-registry.js";

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
  const [activePanelId, setActivePanelId] = useState<string>(COCKPIT_PANELS[0]?.id ?? "");
  const active = getPanel(activePanelId);
  const Body = active?.component;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-2 py-1 text-xs rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-elevated cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ← Back
        </button>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">{title || id}</span>
          <span className="text-[10px] text-text-muted truncate" title={cwd}>
            {cwd}
          </span>
        </div>
      </header>

      <nav
        aria-label="Cockpit panels"
        className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-surface shrink-0"
      >
        {COCKPIT_PANELS.map((panel) => (
          <button
            key={panel.id}
            type="button"
            aria-current={activePanelId === panel.id ? "page" : undefined}
            onClick={() => setActivePanelId(panel.id)}
            className={[
              "px-2.5 py-1 text-xs rounded-md transition-colors duration-150 cursor-pointer",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
              activePanelId === panel.id
                ? "bg-accent/15 text-text-primary font-medium"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
            ].join(" ")}
          >
            {panel.label}
          </button>
        ))}
      </nav>

      <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {Body && <Body dir={dir} id={id} cwd={cwd} />}
      </main>
    </div>
  );
}
