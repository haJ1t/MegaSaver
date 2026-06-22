import { useCallback, useEffect, useState } from "react";
import type { BridgeError } from "../../components/states.js";
import { EmptyState, ErrorState, LoadingState } from "../../components/states.js";
import {
  type CreateAgentInput,
  type OfficeAgent,
  type OfficeRole,
  type OfficeStatus,
  type OfficeStatusEntry,
  assignTask,
  controlAgent,
  createAgent,
  deleteAgent,
  fetchOfficeStatus,
  fetchRoles,
  runAgent,
} from "../../lib/office-client.js";

// ── Status dot colors per agent status ────────────────────────────────────────
// Uses tailwind-compatible inline styles referencing design tokens or
// known safe tailwind literals (no dynamic class names).
function statusDotClass(status: string): string {
  switch (status) {
    case "working":
      return "bg-ok";
    case "paused":
      return "bg-warn";
    case "error":
      return "bg-danger";
    case "stopped":
      return "bg-text-muted";
    default:
      // idle and unknown statuses
      return "bg-accent";
  }
}

function relativeTs(ts: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(ts).getTime());
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── AgentCard ─────────────────────────────────────────────────────────────────

type AgentCardProps = {
  entry: OfficeStatusEntry;
  wk: string;
  roles: OfficeRole[];
  nowMs: number;
  onRefresh: () => void;
};

function AgentCard({ entry, wk, roles, nowMs, onRefresh }: AgentCardProps): JSX.Element {
  const { agent, currentTask, lastEvent } = entry;
  const role = roles.find((r) => r.id === agent.roleId);

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [assignInstruction, setAssignInstruction] = useState("");
  const [showAssign, setShowAssign] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function withRefresh(p: Promise<unknown>): void {
    setBusy(true);
    setMutError(null);
    p.then(() => onRefresh())
      .catch((err: unknown) => {
        const e = err as BridgeError;
        setMutError(e.error ?? "Action failed");
      })
      .finally(() => setBusy(false));
  }

  function handleRun(): void {
    withRefresh(runAgent(wk, agent.id));
  }

  function handleControl(action: "pause" | "resume" | "stop"): void {
    withRefresh(controlAgent(wk, agent.id, action));
  }

  function handleRemove(): void {
    withRefresh(deleteAgent(wk, agent.id));
  }

  function handleAssign(e: React.FormEvent): void {
    e.preventDefault();
    const instr = assignInstruction.trim();
    if (!instr) return;
    withRefresh(
      assignTask(wk, agent.id, instr).then(() => {
        setAssignInstruction("");
        setShowAssign(false);
      }),
    );
  }

  return (
    <div
      className="border border-border rounded-md bg-surface p-3 flex flex-col gap-2"
      data-testid={`agent-card-${agent.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDotClass(agent.status)}`}
          aria-label={`status: ${agent.status}`}
          data-status={agent.status}
        />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-text-primary truncate block">{agent.name}</span>
          {role && <span className="text-[10px] text-text-muted truncate block">{role.name}</span>}
        </div>
        <span className="text-[10px] px-1 rounded bg-surface-elevated text-text-secondary shrink-0">
          {agent.status}
        </span>
      </div>

      {/* Current task */}
      {currentTask && (
        <div className="text-[10px] text-text-secondary border-l-2 border-accent/30 pl-2">
          <span className="truncate block">{currentTask.instruction}</span>
          <span className="text-text-muted">{currentTask.status}</span>
        </div>
      )}

      {/* Last event */}
      {lastEvent && (
        <div className="text-[10px] text-text-muted">
          {lastEvent.type} · {relativeTs(lastEvent.ts, nowMs)}
        </div>
      )}

      {/* Mutation error */}
      {mutError && (
        <p role="alert" className="text-[10px] text-danger">
          {mutError}
        </p>
      )}

      {/* Controls */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={handleRun}
          disabled={busy || agent.status === "working"}
          className="text-[10px] px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-surface-elevated cursor-pointer disabled:opacity-40"
        >
          Run
        </button>
        {agent.status === "working" ? (
          <button
            type="button"
            onClick={() => handleControl("pause")}
            disabled={busy}
            className="text-[10px] px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-surface-elevated cursor-pointer disabled:opacity-40"
          >
            Pause
          </button>
        ) : agent.status === "paused" ? (
          <button
            type="button"
            onClick={() => handleControl("resume")}
            disabled={busy}
            className="text-[10px] px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-surface-elevated cursor-pointer disabled:opacity-40"
          >
            Resume
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => handleControl("stop")}
          disabled={busy || agent.status === "stopped" || agent.status === "idle"}
          className="text-[10px] px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-surface-elevated cursor-pointer disabled:opacity-40"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => setShowAssign((v) => !v)}
          className="text-[10px] px-2 py-0.5 rounded border border-border text-accent hover:bg-surface-elevated cursor-pointer"
        >
          Assign
        </button>
        {confirmRemove ? (
          <>
            <span className="text-[10px] text-text-muted">Remove?</span>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="text-[10px] text-danger hover:underline cursor-pointer"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="text-[10px] text-text-muted hover:underline cursor-pointer"
            >
              No
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="text-[10px] text-text-muted hover:text-danger cursor-pointer"
            aria-label={`Remove agent ${agent.name}`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Assign form */}
      {showAssign && (
        <form
          onSubmit={handleAssign}
          className="flex gap-1.5"
          aria-label={`Assign task to ${agent.name}`}
        >
          <input
            value={assignInstruction}
            onChange={(e) => setAssignInstruction(e.target.value)}
            placeholder="Task instruction…"
            className="flex-1 text-xs px-2 py-0.5 border border-border rounded bg-surface text-text-primary"
            aria-label="Task instruction"
          />
          <button
            type="submit"
            disabled={busy || assignInstruction.trim().length === 0}
            className="text-[10px] px-2 py-0.5 rounded bg-accent text-accent-fg cursor-pointer disabled:opacity-40"
          >
            Assign
          </button>
        </form>
      )}
    </div>
  );
}

// ── AgentBoard ────────────────────────────────────────────────────────────────

type AgentBoardProps = {
  wk: string;
  status: OfficeStatus | null;
  onRefresh: () => void;
};

export function AgentBoard({ wk, status, onRefresh }: AgentBoardProps): JSX.Element {
  const [roles, setRoles] = useState<OfficeRole[]>([]);
  const [rolesError, setRolesError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRoleId, setAddRoleId] = useState("");
  const [addWorkdir, setAddWorkdir] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadRoles = useCallback((): void => {
    fetchRoles()
      .then((list) => {
        setRoles(list);
        if (list.length > 0 && !addRoleId) setAddRoleId(list[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        const e = err as BridgeError;
        setRolesError(e.error ?? "Failed to load roles");
      });
  }, [addRoleId]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  function handleAdd(e: React.FormEvent): void {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const input: CreateAgentInput = { name: addName.trim(), roleId: addRoleId };
    if (addWorkdir.trim()) input.workdir = addWorkdir.trim();
    createAgent(wk, input)
      .then(() => {
        setAddName("");
        setAddWorkdir("");
        setShowAdd(false);
        onRefresh();
      })
      .catch((err: unknown) => {
        const e = err as BridgeError;
        setAddError(e.error ?? "Failed to create agent");
      })
      .finally(() => setAdding(false));
  }

  const agents = status?.agents ?? [];

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Agents
        </h2>
        <button
          type="button"
          onClick={() => {
            setShowAdd((v) => !v);
            setAddError(null);
          }}
          className="text-xs text-accent hover:underline cursor-pointer"
        >
          {showAdd ? "Cancel" : "+ Add agent"}
        </button>
      </div>

      {rolesError && (
        <p role="alert" className="text-xs text-danger">
          {rolesError}
        </p>
      )}

      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="p-3 border border-border rounded-md bg-surface-elevated"
          aria-label="Add agent form"
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <label
                className="text-[10px] text-text-muted uppercase tracking-wide"
                htmlFor="agent-name"
              >
                Name *
              </label>
              <input
                id="agent-name"
                required
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="my-agent-1"
                className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label
                className="text-[10px] text-text-muted uppercase tracking-wide"
                htmlFor="agent-role"
              >
                Role *
              </label>
              <select
                id="agent-role"
                value={addRoleId}
                onChange={(e) => setAddRoleId(e.target.value)}
                className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-0.5">
              <label
                className="text-[10px] text-text-muted uppercase tracking-wide"
                htmlFor="agent-workdir"
              >
                Workdir (optional)
              </label>
              <input
                id="agent-workdir"
                value={addWorkdir}
                onChange={(e) => setAddWorkdir(e.target.value)}
                placeholder="/home/user/projects/foo"
                className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary"
              />
            </div>
            {addError && (
              <p role="alert" className="text-xs text-danger">
                {addError}
              </p>
            )}
            <button
              type="submit"
              disabled={adding || addName.trim().length === 0 || !addRoleId}
              className="self-start text-xs px-3 py-1 rounded bg-accent text-accent-fg cursor-pointer disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}

      {agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          description="Add an agent to this workspace and assign it tasks."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {agents.map((entry) => (
            <AgentCard
              key={entry.agent.id}
              entry={entry}
              wk={wk}
              roles={roles}
              nowMs={nowMs}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
