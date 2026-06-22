import { useCallback, useEffect, useState } from "react";
import type { BridgeError } from "../../components/states.js";
import { EmptyState, ErrorState, LoadingState } from "../../components/states.js";
import {
  type CreateRoleInput,
  type OfficeRole,
  createRole,
  deleteRole,
  fetchRoles,
} from "../../lib/office-client.js";

const MODEL_OPTIONS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;
const PERMISSION_MODES = ["plan", "acceptEdits", "full"] as const;

export function RoleManager(): JSX.Element {
  const [roles, setRoles] = useState<OfficeRole[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<BridgeError | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [kind, setKind] = useState("claude-code");
  const [persona, setPersona] = useState("");
  const [model, setModel] = useState<string>(MODEL_OPTIONS[1]);
  const [permissionMode, setPermissionMode] = useState<string>(PERMISSION_MODES[0]);
  const [allowedTools, setAllowedTools] = useState("");
  const [defaultWorkdir, setDefaultWorkdir] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback((): void => {
    fetchRoles()
      .then((list) => {
        setRoles(list);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        setLoadError(err as BridgeError);
        setLoadState("error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm(): void {
    setName("");
    setKind("claude-code");
    setPersona("");
    setModel(MODEL_OPTIONS[1]);
    setPermissionMode(PERMISSION_MODES[0]);
    setAllowedTools("");
    setDefaultWorkdir("");
    setCreateError(null);
  }

  function handleCreate(e: React.FormEvent): void {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    const input: CreateRoleInput = { name: name.trim(), kind };
    if (persona.trim()) input.persona = persona.trim();
    if (model) input.model = model;
    if (permissionMode) input.permissionMode = permissionMode;
    const tools = allowedTools
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tools.length > 0) input.allowedTools = tools;
    if (defaultWorkdir.trim()) input.defaultWorkdir = defaultWorkdir.trim();

    createRole(input)
      .then((role) => {
        setRoles((prev) => [...prev, role]);
        setShowCreate(false);
        resetForm();
      })
      .catch((err: unknown) => {
        const e = err as BridgeError;
        setCreateError(e.error ?? "Failed to create role");
      })
      .finally(() => setCreating(false));
  }

  function handleDeleteConfirm(roleId: string): void {
    setDeletingId(roleId);
    setConfirmDeleteId(null);
    deleteRole(roleId)
      .then(() => {
        setRoles((prev) => prev.filter((r) => r.id !== roleId));
      })
      .catch((err: unknown) => {
        const e = err as BridgeError;
        setCreateError(e.error ?? "Failed to delete role");
      })
      .finally(() => setDeletingId(null));
  }

  if (loadState === "loading") return <LoadingState label="Loading roles…" />;
  if (loadState === "error" && loadError) return <ErrorState error={loadError} onRetry={load} />;

  return (
    <section className="border-b border-border pb-4">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Roles
        </h2>
        <button
          type="button"
          onClick={() => {
            setShowCreate((v) => !v);
            setCreateError(null);
          }}
          className="text-xs text-accent hover:underline cursor-pointer"
        >
          {showCreate ? "Cancel" : "+ New role"}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mx-4 mb-3 p-3 border border-border rounded-md bg-surface-elevated"
          aria-label="Create role form"
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <label
                className="text-[10px] text-text-muted uppercase tracking-wide"
                htmlFor="role-name"
              >
                Name *
              </label>
              <input
                id="role-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-coder"
                className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex flex-col gap-0.5 flex-1">
                <label
                  className="text-[10px] text-text-muted uppercase tracking-wide"
                  htmlFor="role-model"
                >
                  Model
                </label>
                <select
                  id="role-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-0.5 flex-1">
                <label
                  className="text-[10px] text-text-muted uppercase tracking-wide"
                  htmlFor="role-permission"
                >
                  Permission mode
                </label>
                <select
                  id="role-permission"
                  value={permissionMode}
                  onChange={(e) => setPermissionMode(e.target.value)}
                  className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {permissionMode === "full" && (
              <p
                role="alert"
                className="text-[10px] text-warn bg-warn/10 border border-warn/30 rounded px-2 py-1"
              >
                Requires MEGA_OFFICE_ALLOW_FULL on the bridge to actually run with write/bypass
                power; without it, tasks will fail closed.
              </p>
            )}

            <div className="flex flex-col gap-0.5">
              <label
                className="text-[10px] text-text-muted uppercase tracking-wide"
                htmlFor="role-persona"
              >
                Persona (optional)
              </label>
              <input
                id="role-persona"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="Expert TypeScript engineer"
                className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
              />
            </div>

            <div className="flex flex-col gap-0.5">
              <label
                className="text-[10px] text-text-muted uppercase tracking-wide"
                htmlFor="role-tools"
              >
                Allowed tools (comma-separated)
              </label>
              <input
                id="role-tools"
                value={allowedTools}
                onChange={(e) => setAllowedTools(e.target.value)}
                placeholder="Bash,Read,Edit"
                className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
              />
            </div>

            <div className="flex flex-col gap-0.5">
              <label
                className="text-[10px] text-text-muted uppercase tracking-wide"
                htmlFor="role-workdir"
              >
                Default workdir (optional)
              </label>
              <input
                id="role-workdir"
                value={defaultWorkdir}
                onChange={(e) => setDefaultWorkdir(e.target.value)}
                placeholder="/home/user/projects"
                className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
              />
            </div>

            {createError && (
              <p role="alert" className="text-xs text-danger">
                {createError}
              </p>
            )}

            <button
              type="submit"
              disabled={creating || name.trim().length === 0}
              className="self-start text-xs px-3 py-1 rounded bg-accent text-accent-fg cursor-pointer disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      )}

      {roles.length === 0 && !showCreate && (
        <EmptyState
          title="No roles yet"
          description="Create a role to define what an agent can do."
        />
      )}

      <ul className="flex flex-col gap-0 px-4">
        {roles.map((role) => (
          <li
            key={role.id}
            className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-text-primary truncate">{role.name}</span>
                <span className="text-[10px] px-1 rounded bg-surface-elevated text-text-secondary">
                  {role.kind}
                </span>
                <span className="text-[10px] px-1 rounded bg-surface-elevated text-text-secondary">
                  {role.permissionMode}
                </span>
                {role.model && (
                  <span className="text-[10px] px-1 rounded bg-surface-elevated text-text-secondary">
                    {role.model}
                  </span>
                )}
              </div>
              {role.allowedTools.length > 0 && (
                <p className="text-[10px] text-text-muted mt-0.5 truncate">
                  {role.allowedTools.join(", ")}
                </p>
              )}
            </div>
            {confirmDeleteId === role.id ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-text-muted">Delete?</span>
                <button
                  type="button"
                  onClick={() => handleDeleteConfirm(role.id)}
                  disabled={deletingId === role.id}
                  className="text-[10px] text-danger hover:underline cursor-pointer"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-[10px] text-text-muted hover:underline cursor-pointer"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteId(role.id)}
                disabled={deletingId === role.id}
                className="text-[10px] text-text-muted hover:text-danger cursor-pointer shrink-0"
                aria-label={`Delete role ${role.name}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
