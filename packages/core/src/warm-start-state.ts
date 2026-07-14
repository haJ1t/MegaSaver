import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const warmStartStateSchema = z
  .object({ lastSeenAt: z.string().datetime({ offset: true }) })
  .strict();

export type WarmStartState = z.infer<typeof warmStartStateSchema>;

function statePath(rootDir: string, projectId: string): string {
  return join(rootDir, "warm-start", `${projectId}.json`);
}

export function readWarmStartState(rootDir: string, projectId: string): WarmStartState | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(statePath(rootDir, projectId), "utf8"));
    const parsed = warmStartStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Best-effort by contract: the SessionStart hook calls this and must never
// crash or block on a stamp failure — freshness is advisory, not data.
export function stampWarmStartSeen(rootDir: string, projectId: string, now: string): void {
  try {
    const dir = join(rootDir, "warm-start");
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${randomUUID()}.tmp`);
    // ponytail: no fsync — advisory freshness, a lost stamp just re-onboards next session
    writeFileSync(tmp, JSON.stringify({ lastSeenAt: now }));
    renameSync(tmp, statePath(rootDir, projectId));
  } catch {
    // swallow — see contract above
  }
}
