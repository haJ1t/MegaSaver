import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProxyMetrics, StatsError, buildProxyMetrics, readEvents } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, sessionNotFoundMessage, storeCorruptMessage } from "../../errors.js";
import { HOOK_LOG_RELATIVE_PATH } from "../../hooks/logger.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type RunHooksStatusInput = {
  sessionId: string;
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
    `  expand rate: ${pct(a.expand_rate)} | raw stored: ${a.raw_stored_output_count} | avg compression: ${pct(a.avg_compression_ratio)} | proxy-mediated savings: ${a.proxy_mediated_token_savings} B`,
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
    description: "Show proxy adoption metrics and (if a hook log exists) hook-based interception.",
  },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    "hook-log": { type: "string", description: "Override Claude Code hook log path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runHooksStatus({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ...(typeof args["hook-log"] === "string" ? { hookLogPath: args["hook-log"] } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
