import {
  StatsError,
  auditWindowSchema,
  readAuditEvents,
  resolveAuditWindow,
  summarizeAudit,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import { mapErrorToCliMessage, projectNotFoundMessage, storeCorruptMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

const exportFormatSchema = z.enum(["json"]);

export type RunAuditExportInput = {
  projectName: string;
  formatFlag: string | undefined;
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
  now?: () => string;
};

export async function runAuditExport(input: RunAuditExportInput): Promise<0 | 1> {
  const parsedFormat = exportFormatSchema.safeParse(input.formatFlag ?? "json");
  if (!parsedFormat.success) {
    input.stderr(`error: invalid format "${input.formatFlag ?? "json"}" (json)`);
    return 1;
  }

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
    input.stdout(JSON.stringify({ summary, events }));
    return 0;
  } catch (err) {
    if (err instanceof StatsError) {
      const cli = storeCorruptMessage(err.message);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditExportCommand = defineCommand({
  meta: { name: "export", description: "Export the audit summary (+events) as JSON." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    format: { type: "string", default: "json", description: "Export format (json)." },
    window: { type: "string", description: "session | week | all." },
    session: { type: "string", description: "Session id (required for --window session)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runAuditExport({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      formatFlag: typeof args.format === "string" ? args.format : undefined,
      windowFlag: typeof args.window === "string" ? args.window : undefined,
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
