import type { Project } from "@megasaver/core";
import { useState } from "react";
import { createProject } from "../lib/api-client.js";
import { ErrorState } from "./states.js";
import type { BridgeError } from "./states.js";

// Header "New project" control: a button that toggles an inline panel. The form
// collects name + rootPath; the bridge validates that rootPath exists, is a
// directory, and is readable (a clean 400 → shown here).
export function ProjectCreateForm({
  onCreated,
}: {
  onCreated: (project: Project) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<BridgeError | null>(null);

  function reset(): void {
    setName("");
    setRootPath("");
    setError(null);
    setSubmitting(false);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (name.trim().length === 0 || rootPath.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject({ name: name.trim(), rootPath: rootPath.trim() });
      onCreated(project);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err as BridgeError);
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Create new project"
        className="px-3 py-1 text-xs rounded-md bg-accent text-accent-fg cursor-pointer hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        + New project
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 w-80 p-4 rounded-md border border-border bg-surface shadow-lg flex flex-col gap-3">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Project name"
                className="px-2 py-1 text-sm bg-surface-elevated border border-border rounded-md text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Root path
              <input
                type="text"
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="/absolute/path/to/repo"
                aria-label="Project root path"
                className="px-2 py-1 text-sm bg-surface-elevated border border-border rounded-md text-text-primary font-mono focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            {error && <ErrorState error={error} />}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="px-3 py-1 text-xs rounded-md text-text-secondary hover:text-text-primary cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || name.trim().length === 0 || rootPath.trim().length === 0}
                className="px-3 py-1 text-xs rounded-md bg-accent text-accent-fg cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
