import { useEffect, useMemo, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  hint: string;
  icon: string;
  run: () => void;
};

const MAX_RESULTS = 8;

export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q))
    : [...commands];
  return matched.slice(0, MAX_RESULTS);
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly Command[];
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    // Restore focus to the trigger on unmount (WCAG 2.4.3).
    return () => opener?.focus?.();
  }, []);

  // aria-modal="true" tells AT the background is inert; without a trap the
  // keyboard would disagree and Tab would walk into the sidebar behind the scrim.
  const trapTab = (e: React.KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const runAt = (index: number): void => {
    const cmd = results[index];
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  return (
    <div
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh] bg-scrim backdrop-blur-[2px]"
    >
      {/* role=dialog on a div rather than a native <dialog>: jsdom does not
          implement showModal(), so a native dialog would be untestable here.
          Escape and initial focus are handled explicitly above. biome.json
          scopes the useSemanticElements override to this one file. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            runAt(cursor);
          }
        }}
        className="w-[540px] max-w-[92vw] rounded-2xl border border-border bg-surface shadow-md overflow-hidden pop-in"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Re-typing re-ranks the list, so the highlight returns to the top.
            setCursor(0);
          }}
          placeholder="Jump to a view or a session…"
          aria-label="Search commands"
          className="w-full px-5 py-4 border-0 border-b border-line-soft bg-transparent text-text-primary text-lg outline-none placeholder:text-text-muted"
        />
        <ul className="max-h-[340px] overflow-y-auto p-1.5 list-none m-0">
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => runAt(i)}
                onMouseEnter={() => setCursor(i)}
                aria-current={i === cursor ? "true" : undefined}
                className={[
                  "flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-left cursor-pointer",
                  i === cursor ? "bg-surface-elevated" : "bg-transparent",
                ].join(" ")}
              >
                <span aria-hidden="true" className="w-4 text-center text-xs text-text-muted">
                  {c.icon}
                </span>
                <span className="flex-1 min-w-0 truncate">{c.label}</span>
                <span className="text-xs text-text-muted">{c.hint}</span>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-text-muted">No matches.</li>
          ) : null}
        </ul>
        <div className="flex gap-3.5 px-4 py-2 border-t border-line-soft text-2xs text-text-muted">
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
