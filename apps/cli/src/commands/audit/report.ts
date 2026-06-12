import {
  auditWindowSchema,
  readAuditEvents,
  resolveAuditWindow,
  summarizeAudit,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatAuditCards } from "./shared.js";

export type RunAuditReportInput = {
  projectName: string;
  windowFlag: string | undefined;
  sessionFlag: string | undefined;
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

export async function runAuditReport(input: RunAuditReportInput): Promise<0 | 1> {
  // Validate --window at the boundary before touching the store.
  const rawWindow = input.windowFlag;
  const parsedWindowRaw = rawWindow !== undefined ? auditWindowSchema.safeParse(rawWindow) : null;
  if (parsedWindowRaw !== null && !parsedWindowRaw.success) {
    input.stderr(`error: invalid window "${rawWindow}" (session | week | all)`);
    return 1;
  }
  const resolvedWindow = resolveAuditWindow(parsedWindowRaw?.data, input.sessionFlag !== undefined);

  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let sessionId: ReturnType<typeof sessionIdSchema.parse> | undefined;
  if (resolvedWindow === "session") {
    if (input.sessionFlag === undefined) {
      input.stderr("error: --window session requires --session <id>");
      return 1;
    }
    const parsedSession = sessionIdSchema.safeParse(input.sessionFlag);
    if (!parsedSession.success) {
      input.stderr(`error: invalid session id "${input.sessionFlag}"`);
      return 1;
    }
    sessionId = parsedSession.data;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const now = input.now ?? (() => new Date().toISOString());
    const events = readAuditEvents({ root: rootDir }, project.id, sessionId);
    const summary = summarizeAudit(events, { window: resolvedWindow, now });
    if (input.json) {
      input.stdout(JSON.stringify(summary));
    } else {
      for (const line of formatAuditCards(summary)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditReportCommand = defineCommand({
  meta: { name: "report", description: "Dashboard summary of recorded token/context savings." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    window: { type: "string", description: "session | week | all." },
    session: { type: "string", description: "Session id (required for --window session)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runAuditReport({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      windowFlag: typeof args.window === "string" ? args.window : undefined,
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
