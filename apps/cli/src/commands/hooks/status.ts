import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type ClaudeCodeHookStatus,
  readClaudeCodeHookStatus,
} from "@megasaver/connector-claude-code";
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
  settingsPath?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

function readHookInstallation(input: RunHooksStatusInput): ClaudeCodeHookStatus {
  return readClaudeCodeHookStatus({
    settingsPath: input.settingsPath ?? join(input.home, ".claude", "settings.json"),
  });
}

function renderHookInstallation(status: ClaudeCodeHookStatus): string {
  return `Hook installation: connected=${status.connected ? "yes" : "no"}, cache advice=${status.cacheAdviceInstalled ? "yes" : "no"}`;
}

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

// U+2212 minus so a loss renders as "−1000 B", matching the audit surfaces.
function signedNum(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

// S4-1 net-first: the headline byte figure is the SIGNED net — a workspace
// that re-fetched more than it saved must read negative, not clamp to zero
// (only the priced $ clamps). The re-fetched + overhead figure derives from
// the unclamped delta so it can exceed gross, and the % is the GROSS
// savingRatio, labeled as such so it is never mistaken for a net rate.
function netSavedBreakdown(grossBytes: number, deltaBytes: number, pctLabel: string): string {
  return `net saved ${signedNum(deltaBytes)} B (${grossBytes} B saved − ${grossBytes - deltaBytes} B re-fetched + overhead, ${pctLabel} gross)`;
}

// E27: an overlay session (keyed by Claude transcript UUID) is registered
// nowhere — the overlay files ARE the registration; label it explicitly.
function renderOverlayStatus(
  overlay: { workspaceKey: string; summary: OverlaySessionTokenSaverStats },
  input: RunHooksStatusInput,
  hookInstallation: ClaudeCodeHookStatus,
): void {
  const s = overlay.summary;
  if (input.json) {
    input.stdout(
      JSON.stringify({
        source: "overlay",
        workspaceKey: overlay.workspaceKey,
        ...s,
        hookInstallation,
      }),
    );
    return;
  }
  const pct =
    s.rawBytesTotal === 0 ? "0.0" : ((s.bytesSavedTotal / s.rawBytesTotal) * 100).toFixed(1);
  input.stdout(renderHookInstallation(hookInstallation));
  input.stdout("Live hook session (overlay):");
  input.stdout(`  workspace: ${overlay.workspaceKey}`);
  input.stdout(`  events: ${s.eventsTotal}`);
  if (s.deltaBytesTotal === undefined) {
    // Pre-B1 summary: no expansion data exists, so only the gross is honest.
    input.stdout(
      `  bytes: ${s.rawBytesTotal} raw -> ${s.returnedBytesTotal} returned (saved ${pct}%)`,
    );
  } else {
    // Signed net — a losing session must read negative here (S4-1); the % is
    // the gross ratio, labeled so.
    const net = s.deltaBytesTotal;
    input.stdout(`  bytes: ${s.rawBytesTotal} raw -> ${s.returnedBytesTotal} returned`);
    input.stdout(
      `  saved: ${signedNum(net)} B net (${s.bytesSavedTotal} B saved − ${s.bytesSavedTotal - net} B re-fetched + overhead, ${pct}% gross)`,
    );
  }
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
  const hookInstallation = readHookInstallation(input);

  if (input.json) {
    input.stdout(
      JSON.stringify({ workspaces: perWorkspace, total, heartbeat: hb, hookInstallation }),
    );
    return 0;
  }
  const pct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
  input.stdout(renderHookInstallation(hookInstallation));
  input.stdout("Hook savings by workspace:");
  if (perWorkspace.length === 0) input.stdout("  (no hook sessions recorded)");
  for (const t of perWorkspace) {
    input.stdout(
      `  ${t.workspaceKey}: ${t.sessionsCount} sessions, ${t.eventsTotal} events, ${netSavedBreakdown(t.bytesSavedTotal, t.deltaBytesTotal, pct(t.savingRatio))}`,
    );
  }
  input.stdout(
    `  TOTAL: ${total.sessionsCount} sessions across ${total.workspaceCount} workspaces, ${netSavedBreakdown(total.bytesSavedTotal, total.deltaBytesTotal, pct(total.savingRatio))}`,
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
  const hookInstallation = readHookInstallation(input);

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
        renderOverlayStatus(overlay, input, hookInstallation);
        return 0;
      }
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const events = readEvents({ root: rootDir }, session.projectId, parsedSessionId);
    const metrics = buildProxyMetrics({ events, hookLog: readHookLog(hookLogPath) });
    if (input.json) {
      input.stdout(JSON.stringify({ ...metrics, hookInstallation }));
    } else {
      input.stdout(renderHookInstallation(hookInstallation));
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
    settings: { type: "string", description: "Override Claude Code settings path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runHooksStatus({
      ...(typeof args.sessionId === "string" ? { sessionId: args.sessionId } : {}),
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ...(typeof args["hook-log"] === "string" ? { hookLogPath: args["hook-log"] } : {}),
      ...(typeof args.settings === "string" ? { settingsPath: args.settings } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
