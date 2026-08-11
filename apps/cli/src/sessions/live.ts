import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLiveTable } from "@megasaver/daemon";
import { z } from "zod";
import { resolveStorePath } from "../store.js";

const rawSessionSchema = z
  .object({
    liveSessionId: z.string().min(1),
    agent: z.string().min(1),
    cwd: z.string().min(1),
    branch: z.string().optional(),
    task: z.string().optional(),
    lastSeenAt: z.string().datetime({ offset: true }),
    lastHookEvent: z.string().optional(),
  })
  .strict();

const rawFileSchema = z.array(rawSessionSchema);

function liveSessionsPath(storeRoot: string): string {
  return join(storeRoot, "daemon", "live-sessions.json");
}

function readLiveSessionsFile(storeRoot: string): z.infer<typeof rawFileSchema> | null {
  const path = liveSessionsPath(storeRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const parsed = rawFileSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export type RunSessionsLiveInput = {
  home: string;
  storeFlag?: string;
  xdgDataHome?: string;
  platform: NodeJS.Platform;
  localAppData?: string;
  storeRoot?: string;
  json?: boolean;
  now?: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionsLive(input: RunSessionsLiveInput): Promise<0 | 1> {
  const storeRoot =
    input.storeRoot ??
    resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: process.cwd(),
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });

  const nowMs = input.now ? input.now() : Date.now();
  const rawSessions = readLiveSessionsFile(storeRoot);

  if (!rawSessions || rawSessions.length === 0) {
    if (input.json) {
      const empty = { version: 1, sessions: [], total: 0, warnings: ["daemon not running"] };
      input.stdout(JSON.stringify(empty, null, 2));
      return 0;
    }
    input.stderr("no live sessions (daemon not running — run mega daemon start)");
    input.stdout("no live sessions");
    return 0;
  }

  // statsBurn: try to read overlay summary per session; burn = bytesSavedTotal or null
  // CLI is forbidden from importing @megasaver/stats directly (dependency-graph guard),
  // so read the JSON file directly via fs instead of via the package's reader.
  const statsBurn = new Map<string, number | null>();
  for (const s of rawSessions) {
    try {
      const { encodeWorkspaceKey } = await import("@megasaver/shared");
      const wk = encodeWorkspaceKey(s.cwd);
      const summaryPath = join(storeRoot, "stats", wk, `${s.liveSessionId}.json`);
      if (existsSync(summaryPath)) {
        const raw = readFileSync(summaryPath, "utf8");
        const json = JSON.parse(raw) as { bytesSavedTotal?: number };
        statsBurn.set(
          s.liveSessionId,
          typeof json.bytesSavedTotal === "number" ? json.bytesSavedTotal : null,
        );
      } else {
        statsBurn.set(s.liveSessionId, null);
      }
    } catch {
      statsBurn.set(s.liveSessionId, null);
    }
  }

  // claimCounts: optional claims.json at daemon/claims.json
  const claimCounts = new Map<string, number>();
  const claimsPath = join(storeRoot, "daemon", "claims.json");
  if (existsSync(claimsPath)) {
    try {
      const raw = JSON.parse(readFileSync(claimsPath, "utf8")) as Record<string, string[]>;
      for (const [sid, scopes] of Object.entries(raw)) {
        claimCounts.set(sid, Array.isArray(scopes) ? scopes.length : 0);
      }
    } catch {
      // ignore
    }
  }

  const sessions = rawSessions.map((s) => ({
    liveSessionId: s.liveSessionId,
    agent: s.agent,
    cwd: s.cwd,
    lastSeenAt: s.lastSeenAt,
    ...(s.branch !== undefined ? { branch: s.branch } : {}),
    ...(s.task !== undefined ? { task: s.task } : {}),
    ...(s.lastHookEvent !== undefined ? { lastHookEvent: s.lastHookEvent } : {}),
  }));
  const table = buildLiveTable({
    sessions,
    statsBurn,
    ...(claimCounts.size > 0 ? { claimCounts } : {}),
    now: () => nowMs,
  });

  if (input.json) {
    input.stdout(JSON.stringify(table, null, 2));
    return 0;
  }

  // human table
  input.stdout(`# live sessions (${table.total})`);
  if (table.sessions.length === 0) {
    input.stdout("no live sessions");
    return 0;
  }
  input.stdout("id       agent    cwd       branch  status   burn    claims");
  input.stdout("-------- -------- --------- ------- -------- ------- ------");
  for (const s of table.sessions) {
    const burnStr = s.burn === null ? "n/a" : String(s.burn);
    const branch = s.branch ?? "-";
    input.stdout(
      `${s.liveSessionId.slice(0, 8).padEnd(8)} ${s.agent.padEnd(8)} ${s.cwdShort.padEnd(9)} ${branch.padEnd(7)} ${s.status.padEnd(8)} ${burnStr.padEnd(7)} ${String(s.claimWarnings)}`,
    );
  }
  return 0;
}
