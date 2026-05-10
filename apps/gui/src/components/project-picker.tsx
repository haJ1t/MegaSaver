import type { Project } from "@megasaver/core";
import { useEffect, useRef, useState } from "react";

// localStorage key per spec §3b / §11.
const STORAGE_KEY = "megasaver:gui:v1:active-project-id";

export function readPersistedProjectId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePersistedProjectId(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // localStorage unavailable — silently skip persistence.
  }
}

// ── ProjectPicker ─────────────────────────────────────────────────────────────

type ProjectPickerProps = {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
};

export function ProjectPicker({ projects, activeId, onSelect }: ProjectPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const activeProject = projects.find((p) => p.id === activeId) ?? null;
  const label = activeProject?.name ?? (projects.length === 0 ? "No projects" : "Select project");

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !listRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Keyboard navigation inside listbox (arrow up/down, Enter, Esc).
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setFocusedIndex(0);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, projects.length - 1));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        break;
      }
      case "Enter": {
        e.preventDefault();
        const p = projects[focusedIndex];
        if (p) {
          handleSelect(p.id);
        }
        break;
      }
      case "Escape": {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      }
    }
  }

  function handleSelect(id: string): void {
    onSelect(id);
    writePersistedProjectId(id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="relative">
      {/* Trigger — styled as a terminal-prompt context switcher */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active project: ${label}. Press Enter to change.`}
        onClick={() => {
          setOpen((v) => !v);
          setFocusedIndex(projects.findIndex((p) => p.id === activeId) || 0);
        }}
        onKeyDown={handleKeyDown}
        disabled={projects.length === 0}
        className={[
          "flex items-center gap-2 px-3 py-1.5",
          "text-sm text-text-secondary hover:text-text-primary",
          "border border-border rounded-md bg-surface",
          "cursor-pointer transition-colors duration-150",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
        ].join(" ")}
      >
        {/* Terminal-prompt caret */}
        <span className="text-accent text-xs select-none" aria-hidden="true">
          ▸
        </span>
        <span className="max-w-[180px] truncate">{label}</span>
        {projects.length > 0 && (
          <span
            className={`text-xs text-text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        )}
      </button>

      {/* Listbox */}
      {open && projects.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Projects"
          tabIndex={-1}
          className={[
            "absolute left-0 top-full mt-1 z-50 min-w-[220px]",
            "bg-surface-elevated border border-border rounded-md shadow-md",
            "py-1 text-sm",
            "max-h-60 overflow-y-auto",
          ].join(" ")}
        >
          {projects.map((p, i) => (
            <div
              key={p.id}
              role="option"
              aria-selected={p.id === activeId}
              tabIndex={-1}
              className={[
                "flex items-center gap-2 px-3 py-2 cursor-pointer",
                "transition-colors duration-100",
                i === focusedIndex
                  ? "bg-accent/10 text-text-primary"
                  : "text-text-secondary hover:bg-surface hover:text-text-primary",
                p.id === activeId ? "text-text-primary font-medium" : "",
              ].join(" ")}
              onClick={() => handleSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelect(p.id);
                }
              }}
              onMouseEnter={() => setFocusedIndex(i)}
            >
              {p.id === activeId && (
                <span className="text-accent text-xs" aria-hidden="true">
                  ✓
                </span>
              )}
              {p.id !== activeId && <span className="w-3" aria-hidden="true" />}
              <span className="truncate">{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
