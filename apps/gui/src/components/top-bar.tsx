import { useEffect, useRef, useState } from "react";
import { authHeaders } from "../lib/auth.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { Icon } from "./icons.js";

export function TopBar({
  options,
  activeKey,
  onWorkspaceChange,
  onAddProject,
  onRemoveProject,
  liveCount,
  onOpenPalette,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onWorkspaceChange: (key: string) => void;
  onAddProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
  liveCount: number;
  onOpenPalette: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [inputPath, setInputPath] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.key === activeKey) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (showManual) {
          setShowManual(false);
          setInputPath("");
          setAddError(null);
          return;
        }
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, showManual]);

  const handleManualAdd = (): void => {
    const trimmed = inputPath.trim();
    if (trimmed.length === 0) {
      setAddError("Path is required.");
      return;
    }
    setAddError(null);
    onAddProject(trimmed);
    setInputPath("");
    setShowManual(false);
    setOpen(false);
  };

  const handleNativePick = async (): Promise<void> => {
    const mega = (
      window as unknown as { megasaver?: { pickFolder?: () => Promise<string | null> } }
    ).megasaver;
    if (mega?.pickFolder) {
      setPicking(true);
      setAddError(null);
      try {
        const picked = await mega.pickFolder();
        if (picked === null) return;
        onAddProject(picked);
        setOpen(false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setAddError(msg || "Failed to pick folder.");
      } finally {
        setPicking(false);
      }
      return;
    }
    setPicking(true);
    setAddError(null);
    try {
      const res = await fetch("/api/fs/pick-folder", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const j = (await res.json()) as { ok?: boolean; path?: string | null; error?: string };
        if (j.path) {
          onAddProject(j.path);
          setOpen(false);
          return;
        }
        if (j.path === null) return;
        if (j.error) throw new Error(j.error);
      }
      if (res.status === 501) {
        setShowManual(true);
        setAddError("Native picker not available on this platform. Please paste the path below.");
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Failed to pick folder (${res.status})`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("501") || msg.toLowerCase().includes("not available")) {
        setShowManual(true);
        setAddError("Native picker not available. Please paste the path below.");
        return;
      }
      setAddError(msg || "Failed to pick folder.");
    } finally {
      setPicking(false);
    }
  };

  return (
    <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
          className="flex items-center gap-2.5 pl-3 pr-2.5 py-1.5 rounded-lg border border-border bg-background cursor-pointer hover:bg-surface-elevated"
        >
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="font-medium">{active ? active.label : "Select workspace"}</span>
          {active ? <span className="font-mono text-xs text-text-muted">{active.cwd}</span> : null}
          <span aria-hidden="true" className="grid place-items-center text-text-muted">
            <Icon name="chevron-down" />
          </span>
        </button>
        {open ? (
          <div className="absolute top-[calc(100%+6px)] left-0 z-40 w-[360px] p-1.5 rounded-xl border border-border bg-surface shadow-md pop-in flex flex-col gap-1">
            {options.length === 0 ? (
              <p className="px-2.5 py-2 text-sm text-text-muted">No project added yet.</p>
            ) : (
              <ul
                aria-label="Switch workspace"
                className="list-none m-0 p-0 flex flex-col gap-0.5 max-h-[280px] overflow-y-auto"
              >
                {options.map((o) => (
                  <li key={o.key} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-current={o.key === activeKey ? "true" : undefined}
                      onClick={() => {
                        onWorkspaceChange(o.key);
                        setOpen(false);
                      }}
                      className="flex items-center gap-2.5 flex-1 min-w-0 px-2.5 py-2 rounded-md bg-transparent text-left cursor-pointer hover:bg-surface-elevated"
                    >
                      <span
                        aria-hidden="true"
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.key === activeKey ? "bg-accent" : "bg-border"}`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium truncate">{o.label}</span>
                        <span className="block font-mono text-xs text-text-muted truncate">
                          {o.cwd}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${o.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveProject(o.cwd);
                      }}
                      className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-red-500 hover:bg-red-50 cursor-pointer"
                      title="Remove project"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border pt-1.5 mt-1 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void handleNativePick()}
                disabled={picking}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md border border-dashed border-border text-sm text-text-secondary hover:border-accent hover:text-accent cursor-pointer disabled:opacity-50"
              >
                {picking ? "Opening..." : "+ Add project"}
              </button>
              {!showManual ? (
                <button
                  type="button"
                  onClick={() => setShowManual(true)}
                  className="w-full text-center text-xs text-text-muted hover:text-text-secondary cursor-pointer"
                >
                  or paste path manually
                </button>
              ) : null}
              {addError ? <span className="text-xs text-red-500 px-1">{addError}</span> : null}
              {showManual ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    type="text"
                    value={inputPath}
                    onChange={(e) => setInputPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleManualAdd();
                      if (e.key === "Escape") {
                        setShowManual(false);
                        setInputPath("");
                        setAddError(null);
                      }
                    }}
                    placeholder="/absolute/path/to/project"
                    className="w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-sm font-mono outline-none focus:border-accent"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleManualAdd}
                      className="flex-1 px-2.5 py-1.5 rounded-md bg-accent text-accent-fg text-sm font-medium cursor-pointer hover:opacity-90"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowManual(false);
                        setInputPath("");
                        setAddError(null);
                      }}
                      className="px-3 py-1.5 rounded-md border border-border text-sm cursor-pointer hover:bg-surface-elevated"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex items-center gap-2 ml-auto px-2.5 py-1.5 rounded-lg border border-border bg-background text-text-muted cursor-pointer hover:text-text-primary hover:bg-surface-elevated"
      >
        <span aria-hidden="true" className="grid place-items-center">
          <Icon name="sessions" />
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
