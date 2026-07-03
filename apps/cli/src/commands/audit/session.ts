import {
  StatsError,
  readAuditEvents,
  readOverlaySummaryAnyWorkspace,
  summarizeAudit,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, sessionNotFoundMessage, storeCorruptMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { formatAuditCards, formatOverlaySaverCard } from "./shared.js";

export type RunAuditSessionInput = {
  sessionId: string;
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

export async function runAuditSession(input: RunAuditSessionInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
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
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const session = registry.getSession(parsedSessionId);
    if (!session) {
      const overlay = readOverlaySummaryAnyWorkspace({ root: rootDir }, parsedSessionId);
      if (overlay) {
        if (input.json) input.stdout(JSON.stringify(overlay.summary));
        else
          for (const line of formatOverlaySaverCard(overlay.summary, overlay.workspaceKey))
            input.stdout(line);
        return 0;
      }
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const now = input.now ?? (() => new Date().toISOString());
    const events = readAuditEvents({ root: rootDir }, session.projectId, parsedSessionId);
    const summary = summarizeAudit(events, { window: "session", now });
    if (input.json) input.stdout(JSON.stringify(summary));
    else for (const line of formatAuditCards(summary)) input.stdout(line);
    return 0;
  } catch (err) {
    if (err instanceof StatsError) {
      const cli = storeCorruptMessage(err.message);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const cli = mapErrorToCliMessage(err, { kind: "session", id: parsedSessionId });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditSessionCommand = defineCommand({
  meta: { name: "session", description: "Audit summary for one session." },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runAuditSession({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
