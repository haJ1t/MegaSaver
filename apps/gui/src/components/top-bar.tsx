import { useEffect, useRef, useState } from "react";
import type { WorkspaceOption } from "../lib/workspace-context.js";

export function TopBar({
  options,
  activeKey,
  onWorkspaceChange,
  liveCount,
  onOpenPalette,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onWorkspaceChange: (key: string) => void;
  liveCount: number;
  onOpenPalette: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.key === activeKey) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={options.length === 0}
          aria-expanded={open}
          aria-haspopup="true"
          className="flex items-center gap-2.5 pl-3 pr-2.5 py-1.5 rounded-lg border border-border bg-background cursor-pointer hover:bg-surface-elevated disabled:opacity-60 disabled:cursor-default"
        >
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="font-medium">{active ? active.label : "No workspace"}</span>
          {active ? <span className="font-mono text-xs text-text-muted">{active.cwd}</span> : null}
          <span aria-hidden="true" className="text-2xs text-text-muted">
            ▼
          </span>
        </button>
        {/* A disclosure list of buttons, not a listbox: buttons are natively
            focusable and announce themselves, so no ARIA role is needed and the
            non-interactive <ul> keeps its own semantics. */}
        {open && options.length > 0 ? (
          <ul
            aria-label="Switch workspace"
            className="absolute top-[calc(100%+6px)] left-0 z-40 w-[300px] p-1.5 list-none m-0 rounded-xl border border-border bg-surface shadow-md pop-in"
          >
            {options.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  aria-current={o.key === activeKey ? "true" : undefined}
                  onClick={() => {
                    onWorkspaceChange(o.key);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md bg-transparent text-left cursor-pointer hover:bg-surface-elevated"
                >
                  <span
                    aria-hidden="true"
                    className={`w-1.5 h-1.5 rounded-full ${o.key === activeKey ? "bg-accent" : "bg-border"}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{o.label}</span>
                    <span className="block font-mono text-xs text-text-muted truncate">
                      {o.cwd}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="flex items-center gap-2 ml-auto px-2.5 py-1.5 rounded-lg border border-border bg-background text-text-muted cursor-pointer hover:text-text-primary hover:bg-surface-elevated"
      >
        <span aria-hidden="true" className="text-xs">
          ⌕
        </span>
        Search or jump to
        <kbd className="px-1.5 py-px rounded-sm border border-border font-mono text-xs">⌘K</kbd>
      </button>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg badge-status-live text-xs font-medium">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />
        {liveCount} live
      </div>
    </header>
  );
}
