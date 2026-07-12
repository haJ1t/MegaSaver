import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Small advisory state for the Mistake Firewall (spec §3.4): mode, mutes,
// per-session cooldown, and intercept context for the outcome loop. Pattern
// cloned from warm-start-state.ts: null on missing/corrupt, tmp+rename write,
// no fsync. Concurrent writers (guard hook, saver outcome step, CLI) are
// last-writer-wins by design — a lost strike is advisory, corruption is what
// tmp+rename prevents.
export const GUARD_STATE_MAX_SESSIONS = 20;

const sessionEntrySchema = z
  .object({
    firedIds: z.array(z.string()),
    // intercepts: interceptEventId -> the normalized command, the ORIGINAL
    // failure's signatures (outcome classification), and the matched candidate
    // id (auto-mute strike key) — all captured at intercept time so the
    // PostToolUse outcome step needs no registry/corpus read.
    intercepts: z.record(
      z
        .object({
          command: z.string(),
          signatures: z.array(z.string()),
          candidateId: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const guardStateSchema = z
  .object({
    mode: z.enum(["warn", "strict"]),
    mutedIds: z.array(z.string()),
    autoMuted: z.record(z.number().int().nonnegative()),
    sessions: z.record(sessionEntrySchema),
  })
  .strict();

export type GuardState = z.infer<typeof guardStateSchema>;

export const DEFAULT_GUARD_STATE: GuardState = {
  mode: "warn",
  mutedIds: [],
  autoMuted: {},
  sessions: {},
};

function statePath(rootDir: string, projectId: string): string {
  return join(rootDir, "guard", `${projectId}.json`);
}

export function readGuardState(rootDir: string, projectId: string): GuardState | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(statePath(rootDir, projectId), "utf8"));
    const parsed = guardStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeGuardState(rootDir: string, projectId: string, state: GuardState): void {
  try {
    const keys = Object.keys(state.sessions);
    const kept =
      keys.length > GUARD_STATE_MAX_SESSIONS ? keys.slice(-GUARD_STATE_MAX_SESSIONS) : keys;
    const sessions = Object.fromEntries(
      kept.map((k) => [k, state.sessions[k] ?? { firedIds: [], intercepts: {} }]),
    );
    const dir = join(rootDir, "guard");
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify({ ...state, sessions }));
    renameSync(tmp, statePath(rootDir, projectId));
  } catch {
    // best-effort — advisory state, never blocks a hook
  }
}
