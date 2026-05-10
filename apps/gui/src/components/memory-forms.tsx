import type { MemoryEntry, Session } from "@megasaver/core";
import { useState } from "react";
import type { BridgeError } from "./states.js";
import { ErrorState } from "./states.js";

const MEMORY_SCOPES = ["project", "session"] as const;

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

// ── CreateMemoryForm ──────────────────────────────────────────────────────────

type CreateMemoryFormProps = {
  projectId: string;
  sessions: Session[];
  onCreated: (entry: MemoryEntry) => void;
  onCancel: () => void;
  onCreate: (body: {
    projectId: string;
    content: string;
    scope: string;
    sessionId?: string;
  }) => Promise<MemoryEntry>;
};

export function CreateMemoryForm({
  projectId,
  sessions,
  onCreated,
  onCancel,
  onCreate,
}: CreateMemoryFormProps): JSX.Element {
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"project" | "session">("project");
  const [sessionId, setSessionId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<BridgeError | null>(null);

  // Only open sessions can be linked (spec §4a cross-field guard).
  const openSessions = sessions.filter((s) => s.endedAt === null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: {
        projectId: string;
        content: string;
        scope: string;
        sessionId?: string;
      } = { projectId, content: content.trim(), scope };
      if (scope === "session" && sessionId) {
        body.sessionId = sessionId;
      }
      const entry = await onCreate(body);
      onCreated(entry);
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
      aria-label="Create memory entry"
    >
      <p className="text-xs text-text-muted uppercase tracking-widest">New memory entry</p>
      {error && <ErrorState error={error} />}

      <div>
        <FieldLabel htmlFor="cm-content">Content</FieldLabel>
        <textarea
          id="cm-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Memory entry content…"
          rows={4}
          required
          className={`${INPUT_BASE} resize-y font-mono`}
        />
      </div>

      <div>
        <FieldLabel htmlFor="cm-scope">Scope</FieldLabel>
        <select
          id="cm-scope"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as "project" | "session");
            setSessionId("");
          }}
          className={SELECT_BASE}
        >
          {MEMORY_SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {scope === "session" && (
        <div>
          <FieldLabel htmlFor="cm-session">Session</FieldLabel>
          <select
            id="cm-session"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            required
            className={SELECT_BASE}
            aria-describedby="cm-session-hint"
          >
            <option value="">— Select a session —</option>
            {openSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title ?? s.id.slice(0, 8)} ({s.agentId})
              </option>
            ))}
          </select>
          {openSessions.length === 0 && (
            <p id="cm-session-hint" className="mt-1 text-xs text-text-muted">
              No open sessions. Create a session first or use project scope.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={
            submitting || (scope === "session" && !sessionId) || content.trim().length === 0
          }
          className={[
            "px-4 py-1.5 text-sm rounded-md",
            "bg-accent text-accent-fg font-medium",
            "cursor-pointer hover:opacity-90 transition-opacity duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "focus-visible:outline-2 focus-visible:outline-offset-2",
          ].join(" ")}
        >
          {submitting ? "Saving…" : "Create"}
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
    </form>
  );
}
