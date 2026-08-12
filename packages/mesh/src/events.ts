import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { meshPaths } from "./paths.js";
import { type MeshEvent, meshEventSchema } from "./types.js";

const MAX_RETURNED = 500;

export function postEvent(storeRoot: string, evt: MeshEvent): void {
  const parsed = meshEventSchema.parse(evt);
  const { eventsPath } = meshPaths(storeRoot);
  mkdirSync(dirname(eventsPath), { recursive: true, mode: 0o700 });
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const result = meshEventSchema.safeParse(parsed);
    if (!result.success) continue;
    const evt = result.data;
    if (hasSince) {
      const evtMs = Date.parse(evt.createdAt);
      if (!Number.isNaN(evtMs) && evtMs < (sinceMs as number)) continue;
    }
    // repo filter is advisory; MeshEvent has no repo field, so ignore
    // but if repo is provided, we could filter by from/to containing repo? keep all for now
    events.push(evt);
  }
  if (events.length > MAX_RETURNED) {
    return events.slice(-MAX_RETURNED);
  }
  return events;
}
