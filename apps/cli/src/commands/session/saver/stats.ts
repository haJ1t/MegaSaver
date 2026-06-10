import { type SessionTokenSaverStats, StatsError, readSummary } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  mapErrorToCliMessage,
  sessionNotFoundMessage,
  storeCorruptMessage,
  unexpectedModeMessage,
} from "../../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../../store.js";

export type RunSessionSaverStatsInput = {
  sessionId: string;
  modeFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: () => string;
};

export async function runSessionSaverStats(input: RunSessionSaverStatsInput): Promise<0 | 1> {
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

  if (input.modeFlag !== undefined) {
    const cli = unexpectedModeMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const session = registry.getSession(parsedSessionId);
    if (!session) {
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const ts = session.tokenSaver;
    const eventStats: SessionTokenSaverStats | null = readSummary(
      { root: rootDir },
      session.projectId,
      parsedSessionId,
    );
    if (input.json) {
      input.stdout(
        JSON.stringify({ sessionId: parsedSessionId, tokenSaver: ts ?? null, eventStats }),
      );
      return 0;
    }
    if (!ts) {
      input.stdout(
        `Mega Saver Mode not configured for ${parsedSessionId} — run: mega session saver enable ${parsedSessionId} --mode <mode>`,
      );
      return 0;
    }
    input.stdout(
      `Mega Saver Mode ${ts.enabled ? "enabled" : "disabled"} for ${parsedSessionId} (${ts.mode}; ${ts.maxReturnedBytes} B)`,
    );
    if (!eventStats) {
      input.stdout("No events recorded yet.");
      return 0;
    }
    const pct = (eventStats.savingRatio * 100).toFixed(1);
    input.stdout(
      `events: ${eventStats.eventsTotal} | raw: ${eventStats.rawBytesTotal} B | returned: ${eventStats.returnedBytesTotal} B | saved: ${eventStats.bytesSavedTotal} B (${pct}%)`,
    );
    input.stdout(
      `secrets redacted: ${eventStats.secretsRedactedTotal} | chunks stored: ${eventStats.chunksStoredTotal} | updated: ${eventStats.updatedAt}`,
    );
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

export const sessionSaverStatsCommand = defineCommand({
  meta: { name: "stats", description: "Show Mega Saver Mode stats for a session." },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    mode: { type: "string", description: "Rejected — --mode is only valid on enable." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverStats({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      modeFlag: typeof args.mode === "string" ? args.mode : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
