import { type TokenSaverEvent, readEvents, readWarmStartEvents } from "@megasaver/core";
import { type ResolveStorePathInput, ensureStoreReady, resolveStorePath } from "../../store.js";

// The honest upsell shown when a free user runs a Pro-gated savings command.
// Exit 0 (not an error): a locked feature is a normal state, not a failure. No
// Pro compute runs before this prints — checkEntitlement gates first.
export const PRO_ANALYTICS_URL = "https://megasaver.dev/pro";
export const PRO_ANALYTICS_UPSELL = `Historical savings analytics is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type SavingsSnapshot = {
  events: TokenSaverEvent[];
  eventsByProject: Record<string, TokenSaverEvent[]>;
};

export type SavingsEventReader = () => SavingsSnapshot | Promise<SavingsSnapshot>;

// The production reader: enumerate every project + session in the store and
// collect their recorded TokenSaverEvents. Reads through @megasaver/core
// (never @megasaver/stats directly) so the CLI keeps its acyclic dep graph.
export function defaultSavingsEventReader(storeInput: ResolveStorePathInput): SavingsEventReader {
  return async () => {
    const rootDir = resolveStorePath(storeInput);
    const { registry } = await ensureStoreReady(rootDir);
    const events: TokenSaverEvent[] = [];
    const eventsByProject: Record<string, TokenSaverEvent[]> = {};
    for (const project of registry.listProjects()) {
      for (const session of registry.listSessions(project.id)) {
        const sessionEvents = readEvents({ root: rootDir }, project.id, session.id);
        if (sessionEvents.length === 0) continue;
        events.push(...sessionEvents);
        const bucket = eventsByProject[project.name] ?? [];
        bucket.push(...sessionEvents);
        eventsByProject[project.name] = bucket;
      }
    }
    return { events, eventsByProject };
  };
}

export type WarmStartTotals = { sessions: number; briefTokens: number };
export type WarmStartTotalsReader = () => WarmStartTotals | Promise<WarmStartTotals>;

// Parallel to defaultSavingsEventReader, but sums measured WarmStartEvents
// instead. These are measured brief-token sizes, NOT counterfactual savings —
// they must never be mixed into TokenSaverEvent totals.
export function defaultWarmStartTotalsReader(
  storeInput: ResolveStorePathInput,
): WarmStartTotalsReader {
  return async () => {
    const rootDir = resolveStorePath(storeInput);
    const { registry } = await ensureStoreReady(rootDir);
    let sessions = 0;
    let briefTokens = 0;
    for (const project of registry.listProjects()) {
      for (const e of readWarmStartEvents({ root: rootDir }, project.id)) {
        sessions += 1;
        briefTokens += e.briefTokens;
      }
    }
    return { sessions, briefTokens };
  };
}

export function formatWarmStartLine(totals: WarmStartTotals): string | null {
  if (totals.sessions === 0) return null;
  return `Warm start: ${totals.sessions} sessions warmed, ~${totals.briefTokens} brief tokens (measured)`;
}
