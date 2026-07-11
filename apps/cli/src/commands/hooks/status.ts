import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readHeartbeatView } from "@megasaver/context-gate";
import {
  type OverlaySessionTokenSaverStats,
  type ProxyMetrics,
  StatsError,
  type WorkspaceTokenSaverTotals,
  buildProxyMetrics,
  readAllWorkspaceTokenSaverTotals,
  readEvents,
  readOverlaySummaryAnyWorkspace,
  readWorkspaceTokenSaverTotals,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, sessionNotFoundMessage, storeCorruptMessage } from "../../errors.js";
import { HOOK_LOG_RELATIVE_PATH } from "../../hooks/logger.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type RunHooksStatusInput = {
  sessionId?: string; // absent → cross-workspace aggregate view (E28)
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  // Injectable for tests; production resolves <cwd>/.megasaver/hooks/...
  hookLogPath?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

function readHookLog(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    // Unreadable log is treated as absent — adoption-only, never an error.
    return null;
  }
}

function renderText(metrics: ProxyMetrics): string[] {
  const a = metrics.adoption;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    "Proxy adoption (universal):",
    `  adoption rate: ${pct(a.proxy_adoption_rate)} (${a.proxy_call_count} MegaSaver-mediated calls)`,
    `  by type: read=${a.proxy_calls_by_type.proxy_read_file} command=${a.proxy_calls_by_type.proxy_run_command} search=${a.proxy_calls_by_type.proxy_search_code} expand=${a.proxy_calls_by_type.proxy_expand_chunk}`,
    `  expand rate: ${pct(a.expand_rate)} | raw stored: ${a.raw_stored_output_count} | avg compression: ${pct(a.avg_compression_ratio)} | saver-mediated savings: ${a.saver_mediated_token_savings} B`,
  ];
  if (metrics.interception === null) {
    lines.push("", `Hook-based interception: ${metrics.interception_hint}`);
  } else {
    const i = metrics.interception;
    lines.push(
      "",
      "Hook-based interception (Claude Code hook log present):",
      `  interception rate: ${pct(i.hook_interception_rate)} (proxy-eligible ${i.proxy_eligible_calls} of ${i.proxy_eligible_calls + i.native_eligible_calls_from_hook} eligible calls)`,
    );
  }
  return lines;
}

// E27: an overlay session (keyed by Claude transcript UUID) is registered
// nowhere — the overlay files ARE the registration; label it explicitly.
function renderOverlayStatus(
  overlay: { workspaceKey: string; summary: OverlaySessionTokenSaverStats },
  input: RunHooksStatusInput,
): void {
  const s = overlay.summary;
  if (input.json) {
    input.stdout(JSON.stringify({ source: "overlay", workspaceKey: overlay.workspaceKey, ...s }));
    return;
  }
  const pct =
    s.rawBytesTotal === 0 ? "0.0" : ((s.bytesSavedTotal / s.rawBytesTotal) * 100).toFixed(1);
  input.stdout("Live hook session (overlay):");
  input.stdout(`  workspace: ${overlay.workspaceKey}`);
  input.stdout(`  events: ${s.eventsTotal}`);
  input.stdout(
    `  bytes: ${s.rawBytesTotal} raw -> ${s.returnedBytesTotal} returned (saved ${pct}%)`,
  );
  input.stdout(`  updated: ${s.updatedAt}`);
}

// E28: no-arg form — per-workspace totals + TOTAL + heartbeat recency. Reads
// only the stats tree and the heartbeat registry; needs no session registry.
function runAggregateStatus(rootDir: string, input: RunHooksStatusInput): 0 {
  const store = { root: rootDir };
  let workspaceKeys: string[];
  try {
    workspaceKeys = readdirSync(join(rootDir, "stats"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    workspaceKeys = [];
  }
  const perWorkspace: WorkspaceTokenSaverTotals[] = [];
  for (const wk of workspaceKeys) {
    try {
      const totals = readWorkspaceTokenSaverTotals(store, wk);
      if (totals !== null) perWorkspace.push(totals);
    } catch {
      // unsafe segment or unreadable dir — skip, mirroring the stats readers
    }
  }
  const total = readAllWorkspaceTokenSaverTotals(store);
  const hb = readHeartbeatView(rootDir);

  if (input.json) {
    input.stdout(JSON.stringify({ workspaces: perWorkspace, total, heartbeat: hb }));
    return 0;
  }
  const pct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
  input.stdout("Hook savings by workspace:");
  if (perWorkspace.length === 0) input.stdout("  (no hook sessions recorded)");
  for (const t of perWorkspace) {
    input.stdout(
      `  ${t.workspaceKey}: ${t.sessionsCount} sessions, ${t.eventsTotal} events, saved ${t.bytesSavedTotal} B (${pct(t.savingRatio)})`,
    );
  }
  input.stdout(
    `  TOTAL: ${total.sessionsCount} sessions across ${total.workspaceCount} workspaces, saved ${total.bytesSavedTotal} B (${pct(total.savingRatio)})`,
  );
  input.stdout("");
  input.stdout("Hook liveness by workspace:");
  const wks = Object.keys(hb.workspaces).sort();
  if (wks.length === 0) input.stdout("  (no heartbeats recorded)");
  for (const wk of wks) {
    input.stdout(
      `  ${wk}: invoked ${hb.workspaces[wk] ?? "?"}, completed ${hb.completions?.[wk] ?? "never"}, failures ${hb.failures?.[wk]?.count ?? 0}`,
    );
  }
  return 0;
}

export async function runHooksStatus(input: RunHooksStatusInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.sessionId === undefined) {
    return runAggregateStatus(rootDir, input);
  }

  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    parsedSessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const hookLogPath = input.hookLogPath ?? join(input.cwd, HOOK_LOG_RELATIVE_PATH);

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const session = registry.getSession(parsedSessionId);
    if (!session) {
      // E27 keyspace union: the hook writes the overlay keyspace (Claude
      // transcript UUIDs), the registry holds memory sessions — try the
      // second keyspace before declaring the id unknown.
      const overlay = readOverlaySummaryAnyWorkspace({ root: rootDir }, parsedSessionId);
      if (overlay !== null) {
        renderOverlayStatus(overlay, input);
        return 0;
      }
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const events = readEvents({ root: rootDir }, session.projectId, parsedSessionId);
    const metrics = buildProxyMetrics({ events, hookLog: readHookLog(hookLogPath) });
    if (input.json) {
      input.stdout(JSON.stringify(metrics));
    } else {
      for (const line of renderText(metrics)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli =
      err instanceof StatsError
        ? storeCorruptMessage(err.message)
        : mapErrorToCliMessage(err, { kind: "session", id: parsedSessionId });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const hooksStatusCommand = defineCommand({
  meta: {
    name: "status",
    description:
      "Show proxy adoption metrics for a session, resolve live hook (overlay) sessions, or — with no id — aggregate hook savings across workspaces.",
  },
  args: {
    sessionId: {
      type: "positional",
      required: false,
      description: "Session id (UUID). Omit for the cross-workspace aggregate view.",
    },
    store: { type: "string", description: "Override store directory." },
    "hook-log": { type: "string", description: "Override Claude Code hook log path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runHooksStatus({
      ...(typeof args.sessionId === "string" ? { sessionId: args.sessionId } : {}),
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ...(typeof args["hook-log"] === "string" ? { hookLogPath: args["hook-log"] } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
