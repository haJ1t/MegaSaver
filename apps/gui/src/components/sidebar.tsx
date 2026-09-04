import { useEffect, useState } from "react";
import { fetchDaemonStatus, startDaemon, stopDaemon } from "../lib/claude-sessions-client.js";
import { VIEW_LABELS, type ViewId } from "../view-id.js";
import { Icon } from "./icons.js";
import { ThemeToggle } from "./theme-toggle.js";

// Display grouping (logical), independent of the alphabetic VIEW_IDS type pin.
const NAV_GROUPS: ReadonlyArray<{ title: string; items: readonly ViewId[] }> = [
  { title: "Monitor", items: ["overview", "sessions"] },
  { title: "Optimize", items: ["token-saver", "memory"] },
  { title: "Configure", items: ["workspace", "planner", "agent-office", "agent-setup"] },
];

function DaemonFooter(): JSX.Element {
  const [running, setRunning] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

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
    const t = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const toggle = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (running) await stopDaemon();
      else await startDaemon();
      const s = await fetchDaemonStatus();
      setRunning(s.running);
    } catch {
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-auto flex items-center justify-between px-3 pt-3 border-t border-line-soft text-xs text-text-secondary">
      <button
        type="button"
        onClick={() => void toggle()}
        title={running ? "Daemon running — click to stop" : "Daemon stopped — click to start"}
        className="flex items-center gap-2 hover:text-text-primary transition-colors cursor-pointer"
      >
        <span
          className={[
            "inline-block w-1.5 h-1.5 rounded-full",
            running ? "bg-ok pulse-dot" : "bg-text-muted",
          ].join(" ")}
          aria-hidden="true"
        />
        <span>Daemon {running === null ? "…" : running ? "running" : "stopped"}</span>
      </button>
      <ThemeToggle />
    </div>
  );
}

export function Sidebar({
  active,
  onNavigate,
  sessionCount,
  needsSetup,
}: {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  sessionCount?: number | undefined;
  needsSetup?: boolean | undefined;
}): JSX.Element {
  return (
    <aside className="w-[232px] shrink-0 flex flex-col gap-0.5 px-3 pt-4 pb-3 border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-2 pb-5 pt-1">
        <span
          aria-hidden="true"
          className="grid place-items-center w-[22px] h-[22px] rounded-md bg-accent text-accent-fg text-xs font-bold"
        >
          M
        </span>
        {/* Brand, not a heading: each page owns the document's single <h1>. */}
        <span className="font-semibold tracking-tight select-none">Mega Saver</span>
      </div>

      <nav aria-label="Main navigation" className="flex flex-col gap-0.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <div
              id={`nav-group-${group.title}`}
              className="px-2 pt-4 pb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted"
            >
              {group.title}
            </div>
            {/* A labelled list, not role="group": conveys the grouping and the
                item count with native semantics. */}
            <ul aria-labelledby={`nav-group-${group.title}`} className="list-none m-0 p-0">
              {group.items.map((id) => {
                const isActive = active === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => onNavigate(id)}
                      className={[
                        "relative flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left",
                        "transition-colors duration-150 cursor-pointer",
                        isActive
                          ? "bg-accent-soft text-accent font-medium"
                          : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
                      ].join(" ")}
                    >
                      {isActive ? (
                        <span
                          aria-hidden="true"
                          className="absolute -left-3 top-2 bottom-2 w-0.5 rounded-full bg-accent"
                        />
                      ) : null}
                      <span aria-hidden="true" className="grid place-items-center w-4 h-4 shrink-0">
                        <Icon name={id} />
                      </span>
                      {VIEW_LABELS[id]}
                      {id === "sessions" && sessionCount !== undefined ? (
                        <span className="ml-auto font-mono text-xs text-text-muted">
                          {sessionCount}
                        </span>
                      ) : null}
                      {id === "agent-setup" && needsSetup ? (
                        <span
                          role="img"
                          className="ml-auto w-1.5 h-1.5 rounded-full bg-warn"
                          aria-label="Setup needs attention"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <DaemonFooter />
    </aside>
  );
}
