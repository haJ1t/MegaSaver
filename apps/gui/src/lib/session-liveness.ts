import type { ClaudeSessionMeta } from "./claude-sessions-client.js";

// A transcript file touched within this window counts as a live session. Shared
// so the top bar, Overview and the Sessions list can never disagree about the
// same session's dot.
export const LIVE_WINDOW_MS = 8000;

export function isLive(session: ClaudeSessionMeta, nowMs: number): boolean {
  return nowMs - session.mtimeMs < LIVE_WINDOW_MS;
}

export function countLive(sessions: readonly ClaudeSessionMeta[], nowMs: number): number {
  return sessions.filter((s) => isLive(s, nowMs)).length;
}
