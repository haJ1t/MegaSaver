import type { WorkspaceOption } from "../lib/workspace-context.js";

export function WorkspacePicker({
  options,
  activeKey,
  onChange,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
  onChange: (key: string) => void;
}): JSX.Element {
  if (options.length === 0) {
    return <p className="text-sm text-text-muted">No workspaces found.</p>;
  }
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="sr-only">Active workspace</span>
      <select
        aria-label="Active workspace"
        value={activeKey ?? options[0]?.key ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 rounded-md border border-border bg-surface text-xs text-text-primary"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
