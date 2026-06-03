import { useCallback, useEffect, useRef, useState } from "react";
import { type RetentionSummary, clearRetention, fetchRetention } from "../lib/api-client.js";
import { ErrorState, LoadingState } from "./states.js";
import type { BridgeError } from "./states.js";

type RetentionControlsProps = {
  sessionId: string;
};

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RetentionControls({ sessionId }: RetentionControlsProps): JSX.Element {
  const [summary, setSummary] = useState<RetentionSummary | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // WCAG 4.1.3: the destructive outcome must reach AT — the controls re-render
  // silently after clear, so a polite live region announces the result.
  const [announcement, setAnnouncement] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      setSummary(await fetchRetention(sessionId));
      setLoadState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setLoadState("error");
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleClear(): Promise<void> {
    setBusy(true);
    setError(null);
    setAnnouncement("");
    try {
      // The clear route returns the post-clear summary (0), so the displayed
      // count refreshes from the destructive op's own response.
      setSummary(await clearRetention(sessionId));
      setConfirming(false);
      setAnnouncement("Stored raw output cleared.");
    } catch (err) {
      setError(err as BridgeError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Raw output retention" className="mt-6 border-t border-border pt-6">
      <h4 className="mb-3 text-xs font-medium text-text-muted uppercase tracking-widest">
        Raw output retention
      </h4>

      {/* <output> carries an implicit role=status (aria-live=polite). */}
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      {loadState === "loading" && <LoadingState label="Loading retention…" />}

      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorState error={error} onRetry={() => void load()} />
        </div>
      )}

      {loadState === "ready" && summary !== null && (
        <div className="flex flex-col gap-3">
          {summary.chunkSets === 0 ? (
            <p className="text-sm text-text-muted">No stored raw output.</p>
          ) : (
            <>
              <p className="text-sm text-text-primary">
                {summary.chunkSets} chunk sets, {humanBytes(summary.totalBytes)} stored
                {summary.oldestAt && (
                  <span className="text-text-muted">, oldest {formatDate(summary.oldestAt)}</span>
                )}
              </p>

              {confirming ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-danger">Delete all stored raw output?</span>
                  <button
                    type="button"
                    onClick={() => void handleClear()}
                    disabled={busy}
                    className="rounded-md bg-danger px-4 py-1.5 text-sm text-danger-fg cursor-pointer hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {busy ? "Clearing…" : "Confirm clear"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="rounded-md border border-border px-4 py-1.5 text-sm text-text-secondary cursor-pointer hover:text-text-primary transition-colors duration-150 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="self-start rounded-md border border-danger/40 px-4 py-1.5 text-sm text-danger cursor-pointer hover:bg-danger/5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Clear stored raw output
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
