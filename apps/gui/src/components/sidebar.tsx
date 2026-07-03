import { useEffect, useState } from "react";
import { fetchDaemonStatus } from "../lib/claude-sessions-client.js";
import { VIEW_LABELS, type ViewId } from "../view-id.js";

// Display order (logical), independent of the alphabetic VIEW_IDS type pin.
const NAV_ORDER: readonly ViewId[] = [
  "sessions",
  "token-saver",
  "memory",
  "workspace",
  "agent-office",
  "agent-setup",
];

function DaemonFooter(): JSX.Element {
  const [running, setRunning] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const tick = (): void => {
      void fetchDaemonStatus()
        .then((s) => {
          if (live) setRunning(s.running);
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return (
    <div className="mt-auto px-5 py-4 border-t border-border flex items-center gap-2 text-xs text-text-secondary">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${running ? "bg-ok" : "bg-text-muted"}`}
        aria-hidden="true"
      />
      <span>Daemon {running === null ? "…" : running ? "running" : "stopped"}</span>
    </div>
  );
}

export function Sidebar({
  active,
  onNavigate,
}: {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
}): JSX.Element {
  return (
    <aside className="w-[220px] shrink-0 flex flex-col border-r border-border bg-surface">
      <h1 className="px-5 pt-6 pb-4 text-base font-semibold tracking-tight select-none">
        Mega Saver
      </h1>
      <nav aria-label="Main navigation" className="flex flex-col gap-1 px-3">
        {NAV_ORDER.map((id) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(id)}
              className={[
                "px-3 py-2 text-sm text-left rounded-lg transition-colors duration-150 cursor-pointer",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                isActive
                  ? "bg-accent text-accent-fg font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
              ].join(" ")}
            >
              {VIEW_LABELS[id]}
            </button>
          );
        })}
      </nav>
      <DaemonFooter />
    </aside>
  );
}
