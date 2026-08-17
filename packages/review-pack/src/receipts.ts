import { readdirSync } from "node:fs";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import {
  type OverlayTokenSaverEvent,
  type StatsStore,
  type TokenSaverEvent,
  readEvents,
  readOverlayEvents,
} from "@megasaver/stats";

export type ReceiptEvent = TokenSaverEvent | OverlayTokenSaverEvent;

export type ReceiptCandidate = {
  command: string;
  exitCode?: number | null;
  createdAt: string;
  chunkSetId?: string;
};

export const RECEIPT_WINDOW_MINUTES = 1440;

export function readReceiptEvents(
  store: StatsStore,
  keys: { workspaceKey: string; projectId?: string },
): ReceiptEvent[] {
  const events: ReceiptEvent[] = [];

  // Overlay events
  const overlayDir = join(store.root, "stats", keys.workspaceKey);
  let overlayFiles: string[];
  try {
    overlayFiles = readdirSync(overlayDir);
  } catch {
    overlayFiles = [];
  }
  for (const file of overlayFiles) {
    if (!file.endsWith(".events.jsonl")) continue;
    const liveSessionId = file.slice(0, -".events.jsonl".length);
    try {
      events.push(...readOverlayEvents(store, keys.workspaceKey, liveSessionId));
    } catch {
      // tolerant of read errors
    }
  }

  // Registry events
  if (keys.projectId !== undefined) {
    const pId = projectIdSchema.safeParse(keys.projectId);
    if (pId.success) {
      const regDir = join(store.root, "stats", keys.projectId);
      let regFiles: string[];
      try {
        regFiles = readdirSync(regDir);
      } catch {
        regFiles = [];
      }
      for (const file of regFiles) {
        if (!file.endsWith(".events.jsonl")) continue;
        const rawSessionId = file.slice(0, -".events.jsonl".length);
        const sId = sessionIdSchema.safeParse(rawSessionId);
        if (sId.success) {
          try {
            events.push(...readEvents(store, pId.data, sId.data));
          } catch {
            // tolerant of read errors
          }
        }
      }
    }
  }

  return events;
}

export function receiptCandidatesFromEvents(
  events: readonly ReceiptEvent[],
  opts: { now: string; windowMinutes?: number },
): ReceiptCandidate[] {
  const windowMs = (opts.windowMinutes ?? RECEIPT_WINDOW_MINUTES) * 60_000;
  const nowMs = Date.parse(opts.now);
  const cutoff = nowMs - windowMs;

  const candidates: ReceiptCandidate[] = [];
  for (const e of events) {
    if (e.sourceKind !== "command") continue;
    const createdAtMs = Date.parse(e.createdAt);
    if (Number.isFinite(createdAtMs) && createdAtMs < cutoff) continue;

    candidates.push({
      command: e.label,
      ...(e.childExitCode !== undefined ? { exitCode: e.childExitCode } : {}),
      createdAt: e.createdAt,
      ...(e.chunkSetId !== undefined ? { chunkSetId: e.chunkSetId } : {}),
    });
  }
  return candidates;
}
