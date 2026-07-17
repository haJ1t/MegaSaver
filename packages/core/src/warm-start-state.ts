import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonAtomic } from "./json-store.js";

const warmStartStateSchema = z
  .object({ lastSeenAt: z.string().datetime({ offset: true }) })
  .strict();

export type WarmStartState = z.infer<typeof warmStartStateSchema>;

function statePath(rootDir: string, projectId: string): string {
  return join(rootDir, "warm-start", `${projectId}.json`);
}

export function readWarmStartState(rootDir: string, projectId: string): WarmStartState | null {
  const parsed = warmStartStateSchema.safeParse(readJsonFile(statePath(rootDir, projectId)));
  return parsed.success ? parsed.data : null;
}

// Best-effort by contract: the SessionStart hook calls this and must never
// crash or block on a stamp failure — freshness is advisory, not data.
export function stampWarmStartSeen(rootDir: string, projectId: string, now: string): void {
  writeJsonAtomic(join(rootDir, "warm-start"), `${projectId}.json`, { lastSeenAt: now });
}
