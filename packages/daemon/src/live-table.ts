import { z } from "zod";

export const liveSessionSchema = z
  .object({
    liveSessionId: z.string().min(1),
    agent: z.string().min(1),
    cwd: z.string().min(1),
    cwdShort: z.string().min(1),
    branch: z.string().optional(),
    task: z.string().optional(),
    lastSeenAt: z.string().datetime({ offset: true }),
    status: z.enum(["working", "blocked", "done"]),
    burn: z.number().nullable(),
    claimWarnings: z.number().int().nonnegative(),
  })
  .strict();

export const liveTableSchema = z
  .object({
    version: z.literal(1),
    sessions: z.array(liveSessionSchema),
    total: z.number().int().nonnegative(),
    warnings: z.array(z.string()).optional(),
  })
  .strict();

export type LiveSession = z.infer<typeof liveSessionSchema>;
export type LiveTable = z.infer<typeof liveTableSchema>;

export function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? cwd;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function deriveStatus(input: {
  lastSeenAt: string;
  lastHookEvent?: string;
  now: number;
}): LiveSession["status"] {
  const lastSeenMs = Date.parse(input.lastSeenAt);
  if (Number.isNaN(lastSeenMs)) return "done";
  const ageMs = input.now - lastSeenMs;
  if (ageMs < 60_000) return "working";
  if (ageMs < 5 * 60_000) {
    if (input.lastHookEvent === "blocked" || input.lastHookEvent === "needs-input")
      return "blocked";
    return "working";
  }
  return "done";
}

export function buildLiveTable(input: {
  sessions: readonly {
    liveSessionId: string;
    agent: string;
    cwd: string;
    branch?: string;
    task?: string;
    lastSeenAt: string;
    lastHookEvent?: string;
  }[];
  statsBurn: ReadonlyMap<string, number | null>;
  claimCounts?: ReadonlyMap<string, number>;
  now: () => number;
}): LiveTable {
  const nowMs = input.now();
  const sessions: LiveSession[] = input.sessions.map((s) => {
    const status = deriveStatus({
      lastSeenAt: s.lastSeenAt,
      ...(s.lastHookEvent !== undefined ? { lastHookEvent: s.lastHookEvent } : {}),
      now: nowMs,
    });
    const burn = input.statsBurn.get(s.liveSessionId) ?? null;
    const claimWarnings = input.claimCounts?.get(s.liveSessionId) ?? 0;
    const base: LiveSession = {
      liveSessionId: s.liveSessionId,
      agent: s.agent,
      cwd: s.cwd,
      cwdShort: shortCwd(s.cwd),
      lastSeenAt: s.lastSeenAt,
      status,
      burn,
      claimWarnings,
    };
    if (s.branch !== undefined) (base as { branch?: string }).branch = s.branch;
    if (s.task !== undefined) (base as { task?: string }).task = s.task;
    return base;
  });

  sessions.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  return {
    version: 1,
    sessions,
    total: sessions.length,
  };
}
