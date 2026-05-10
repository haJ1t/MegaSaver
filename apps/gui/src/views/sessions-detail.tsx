import type { Session } from "@megasaver/core";
import type { RefObject } from "react";
import { AgentBadge, RiskBadge, StatusBadge } from "../components/badges.js";
import { UpdateSessionForm } from "../components/session-forms.js";
import { ErrorState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { updateSession } from "../lib/api-client.js";
import { shortId } from "../lib/short-id.js";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-muted uppercase tracking-widest">{label}</dt>
      <dd className="text-sm text-text-primary break-all">{children}</dd>
    </div>
  );
}

type SessionsDetailProps = {
  selected: Session;
  endError: BridgeError | null;
  errorRef: RefObject<HTMLDivElement>;
  onClearEndError: () => void;
  showUpdateForm: boolean;
  onShowUpdateForm: () => void;
  onHideUpdateForm: () => void;
  onUpdated: (updated: Session) => void;
  endingId: string | null;
  onEnd: (sessionId: string) => void;
};

export function SessionsDetail({
  selected,
  endError,
  errorRef,
  onClearEndError,
  showUpdateForm,
  onShowUpdateForm,
  onHideUpdateForm,
  onUpdated,
  endingId,
  onEnd,
}: SessionsDetailProps): JSX.Element {
  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-medium text-text-primary">
            {selected.title ?? <span className="text-text-muted italic">Untitled session</span>}
          </h2>
          <p className="text-xs text-text-muted mt-1 font-mono">{selected.id}</p>
        </div>
        <StatusBadge status={selected.endedAt === null ? "open" : "ended"} />
      </div>

      {!showUpdateForm && (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 mb-6">
          <Field label="Agent">
            <AgentBadge agentId={selected.agentId} />
          </Field>
          <Field label="Risk">
            <RiskBadge level={selected.riskLevel} />
          </Field>
          <Field label="Project">{shortId(selected.projectId)}…</Field>
          <Field label="Started">{formatDate(selected.startedAt)}</Field>
          <Field label="Ended">{selected.endedAt ? formatDate(selected.endedAt) : "—"}</Field>
        </dl>
      )}

      {endError && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorState error={endError} onRetry={onClearEndError} />
        </div>
      )}

      {!showUpdateForm && selected.endedAt === null && (
        <div className="flex gap-3 mb-6">
          <button
            type="button"
            onClick={onShowUpdateForm}
            className={[
              "px-4 py-1.5 text-sm rounded-md",
              "border border-border text-text-secondary",
              "cursor-pointer hover:text-text-primary transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
            ].join(" ")}
          >
            Update
          </button>
          <button
            type="button"
            onClick={() => onEnd(selected.id)}
            disabled={endingId === selected.id}
            className={[
              "px-4 py-1.5 text-sm rounded-md",
              "border border-danger/40 text-danger",
              "cursor-pointer hover:bg-danger/5 transition-colors duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
            ].join(" ")}
          >
            {endingId === selected.id ? "Ending…" : "End session"}
          </button>
        </div>
      )}

      {showUpdateForm && selected.endedAt === null && (
        <UpdateSessionForm
          session={selected}
          onUpdated={onUpdated}
          onCancel={onHideUpdateForm}
          onUpdate={updateSession}
        />
      )}
    </>
  );
}
