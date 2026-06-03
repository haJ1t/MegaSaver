import type { Session, TokenSaverSettings } from "@megasaver/core";
import type { SessionTokenSaverStats, TokenSaverEvent } from "@megasaver/stats";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type EnableTokenSaverBody,
  disableTokenSaver,
  enableTokenSaver,
  fetchTokenSaverEvents,
  fetchTokenSaverStats,
  fetchTokenSaverStatus,
  tokenSaverEventRawUrl,
  tokenSaverEventSentUrl,
} from "../lib/api-client.js";
import { ErrorState, LoadingState } from "./states.js";
import type { BridgeError } from "./states.js";
import { TokenSaverModal } from "./token-saver-modal.js";
import { TokenSaverStats } from "./token-saver-stats.js";

type TokenSaverPanelProps = {
  session: Session;
  onSettingsChanged: (session: Session) => void;
};

export function TokenSaverPanel({ session, onSettingsChanged }: TokenSaverPanelProps): JSX.Element {
  const [settings, setSettings] = useState<TokenSaverSettings | null>(null);
  const [stats, setStats] = useState<SessionTokenSaverStats | null>(null);
  const [events, setEvents] = useState<TokenSaverEvent[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const [status, summary, eventList] = await Promise.all([
        fetchTokenSaverStatus(session.id),
        fetchTokenSaverStats(session.id),
        fetchTokenSaverEvents(session.id),
      ]);
      setSettings(status.settings);
      setStats(summary);
      setEvents(eventList);
      setLoadState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setLoadState("error");
    }
  }, [session.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function apply(updated: Session): Promise<void> {
    onSettingsChanged(updated);
    setSettings(updated.tokenSaver ?? null);
    await load();
  }

  async function handleEnable(body: EnableTokenSaverBody): Promise<void> {
    setModalOpen(false);
    try {
      await apply(await enableTokenSaver(session.id, body));
    } catch (err) {
      setError(err as BridgeError);
    }
  }

  async function handleDisable(): Promise<void> {
    try {
      await apply(await disableTokenSaver(session.id));
    } catch (err) {
      setError(err as BridgeError);
    }
  }

  const enabled = settings?.enabled === true;

  return (
    <section aria-label="Mega Saver Mode" className="mt-8 border-t border-border pt-6">
      <h3 className="mb-4 text-sm font-medium text-text-primary uppercase tracking-widest">
        Mega Saver Mode
      </h3>

      {loadState === "loading" && <LoadingState label="Loading Mega Saver Mode…" />}

      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorState error={error} onRetry={() => void load()} />
        </div>
      )}

      {loadState === "ready" && !enabled && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-text-muted">Mega Saver Mode is off for this session.</p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm text-accent-fg cursor-pointer hover:opacity-90 transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Enable Mega Saver Mode
          </button>
        </div>
      )}

      {loadState === "ready" && enabled && settings && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <dl className="flex items-center gap-2">
              <dt className="text-xs text-text-muted uppercase tracking-widest">Mode</dt>
              <dd className="text-sm text-text-primary">{settings.mode}</dd>
            </dl>
            <button
              type="button"
              onClick={() => void handleDisable()}
              aria-pressed={true}
              className="rounded-md border border-danger/40 px-4 py-1.5 text-sm text-danger cursor-pointer hover:bg-danger/5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Disable
            </button>
          </div>

          <TokenSaverStats stats={stats} events={events} />

          {events.length > 0 && (
            <ul className="flex flex-col gap-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="truncate text-text-primary">{event.label}</span>
                  <span className="flex shrink-0 gap-3 text-xs">
                    <a
                      href={tokenSaverEventRawUrl(session.id, event.id)}
                      className="text-accent hover:underline"
                    >
                      raw
                    </a>
                    <a
                      href={tokenSaverEventSentUrl(session.id, event.id)}
                      className="text-accent hover:underline"
                    >
                      sent
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <TokenSaverModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConfirm={(body) => void handleEnable(body)}
      />
    </section>
  );
}
