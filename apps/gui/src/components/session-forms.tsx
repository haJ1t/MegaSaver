import type { Session } from "@megasaver/core";
import { useState } from "react";
import type { BridgeError } from "./states.js";
import { ErrorState } from "./states.js";

// Closed enums from @megasaver/shared — imported directly.
const AGENT_IDS = [
  "aider",
  "claude-code",
  "codex",
  "continue",
  "cursor",
  "gemini",
  "generic-cli",
  "windsurf",
] as const;
const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

// ── Shared form primitives ────────────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs text-text-muted uppercase tracking-widest mb-1"
    >
      {children}
    </label>
  );
}

const INPUT_BASE = [
  "w-full px-3 py-2 text-sm",
  "bg-surface border border-border rounded-md",
  "text-text-primary placeholder:text-text-muted",
  "focus-visible:outline-2 focus-visible:outline-offset-1",
  "transition-colors duration-150",
].join(" ");

const SELECT_BASE = `${INPUT_BASE} cursor-pointer appearance-none`;

function FormActions({
  submitLabel,
  onCancel,
  submitting,
}: {
  submitLabel: string;
  onCancel: () => void;
  submitting: boolean;
}): JSX.Element {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="submit"
        disabled={submitting}
        className={[
          "px-4 py-1.5 text-sm rounded-md",
          "bg-accent text-accent-fg font-medium",
          "cursor-pointer hover:opacity-90 transition-opacity duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
        ].join(" ")}
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className={[
          "px-4 py-1.5 text-sm rounded-md",
          "border border-border text-text-secondary",
          "cursor-pointer hover:text-text-primary transition-colors duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
        ].join(" ")}
      >
        Cancel
      </button>
    </div>
  );
}

// ── CreateSessionForm ─────────────────────────────────────────────────────────

type CreateSessionFormProps = {
  projectId: string;
  onCreated: (session: Session) => void;
  onCancel: () => void;
  onCreate: (body: {
    projectId: string;
    agentId: string;
    title?: string;
    riskLevel?: string;
  }) => Promise<Session>;
};

export function CreateSessionForm({
  projectId,
  onCreated,
  onCancel,
  onCreate,
}: CreateSessionFormProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [agentId, setAgentId] = useState<string>("claude-code");
  const [riskLevel, setRiskLevel] = useState<string>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<BridgeError | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = title.trim();
      const session = await onCreate(
        trimmed
          ? { projectId, agentId, title: trimmed, riskLevel }
          : { projectId, agentId, riskLevel },
      );
      onCreated(session);
    } catch (err) {
      setError(err as BridgeError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 p-4 border-b border-border bg-surface"
      aria-label="Create session"
    >
      <h3 className="text-xs text-text-muted uppercase tracking-widest font-normal">New session</h3>
      {error && <ErrorState error={error} />}

      <div>
        <FieldLabel htmlFor="cs-title">Title (optional)</FieldLabel>
        <input
          id="cs-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Refactor auth module"
          className={INPUT_BASE}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="cs-agent">Agent</FieldLabel>
          <select
            id="cs-agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className={SELECT_BASE}
          >
            {AGENT_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel htmlFor="cs-risk">Risk level</FieldLabel>
          <select
            id="cs-risk"
            value={riskLevel}
            onChange={(e) => setRiskLevel(e.target.value)}
            className={SELECT_BASE}
          >
            {RISK_LEVELS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FormActions submitLabel="Create" onCancel={onCancel} submitting={submitting} />
    </form>
  );
}

// ── UpdateSessionForm ─────────────────────────────────────────────────────────

type UpdateSessionFormProps = {
  session: Session;
  onUpdated: (session: Session) => void;
  onCancel: () => void;
  onUpdate: (
    id: string,
    body: { title?: string | null; riskLevel?: string; agentId?: string },
  ) => Promise<Session>;
};

export function UpdateSessionForm({
  session,
  onUpdated,
  onCancel,
  onUpdate,
}: UpdateSessionFormProps): JSX.Element {
  const [title, setTitle] = useState(session.title ?? "");
  const [agentId, setAgentId] = useState(session.agentId);
  const [riskLevel, setRiskLevel] = useState(session.riskLevel);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<BridgeError | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Empty title → null (mirrors CLI semantics per spec §3c / §4a).
      const titleValue = title.trim() === "" ? null : title.trim();
      const updated = await onUpdate(session.id, {
        title: titleValue,
        agentId,
        riskLevel,
      });
      onUpdated(updated);
    } catch (err) {
      setError(err as BridgeError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-4" aria-label="Update session">
      <h3 className="text-xs text-text-muted uppercase tracking-widest font-normal">
        Edit session
      </h3>
      {error && <ErrorState error={error} />}

      <div>
        <FieldLabel htmlFor="us-title">Title</FieldLabel>
        <input
          id="us-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="(clear to remove title)"
          className={INPUT_BASE}
          aria-describedby="us-title-hint"
        />
        <p className="mt-1 text-xs text-text-muted" id="us-title-hint">
          Leave blank to clear the title.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="us-agent">Agent</FieldLabel>
          <select
            id="us-agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value as (typeof AGENT_IDS)[number])}
            className={SELECT_BASE}
          >
            {AGENT_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel htmlFor="us-risk">Risk level</FieldLabel>
          <select
            id="us-risk"
            value={riskLevel}
            onChange={(e) => setRiskLevel(e.target.value as (typeof RISK_LEVELS)[number])}
            className={SELECT_BASE}
          >
            {RISK_LEVELS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FormActions submitLabel="Save" onCancel={onCancel} submitting={submitting} />
    </form>
  );
}
