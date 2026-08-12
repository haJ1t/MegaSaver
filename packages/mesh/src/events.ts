import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { meshPaths } from "./paths.js";
import { safeJsonParse } from "./store.js";
import { type MeshEvent, meshEventSchema } from "./types.js";

const MAX_RETURNED = 500;

export function postEvent(storeRoot: string, evt: MeshEvent): void {
  const parsed = meshEventSchema.parse(evt);
  const { eventsPath } = meshPaths(storeRoot);
  const dir = dirname(eventsPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {}
  appendFileSync(eventsPath, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
}

export function readEvents(
  storeRoot: string,
  opts: { since?: string; repo?: string },
): MeshEvent[] {
  const { eventsPath } = meshPaths(storeRoot);
  if (!existsSync(eventsPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(eventsPath, "utf8");
  } catch {
    return [];
  }
  const sinceMs = opts.since !== undefined ? Date.parse(opts.since) : undefined;
  const hasSince = sinceMs !== undefined && !Number.isNaN(sinceMs);
  const events: MeshEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const parsed = safeJsonParse(line);
    if (parsed === undefined) continue;
    const result = meshEventSchema.safeParse(parsed);
    if (!result.success) continue;
    const evt = result.data;
    if (hasSince) {
      const evtMs = Date.parse(evt.createdAt);
      if (!Number.isNaN(evtMs) && evtMs < (sinceMs as number)) continue;
    }
    // Phase 1 intentional no-op: MeshEvent has no repo/repositoryFamilyKey field
    // (see boardFactSchema scope.repoKey). `opts.repo` is reserved for Task 7
    // (board) when event-to-repo scoping is introduced; filtering here would be
    // incorrect, so all events pass until then.
    void opts.repo;
    events.push(evt);
  }
  if (events.length > MAX_RETURNED) {
    return events.slice(-MAX_RETURNED);
  }
  return events;
}
