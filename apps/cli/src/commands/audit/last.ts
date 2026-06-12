import { StatsError, readAuditEvents, summarizeAudit } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage, storeCorruptMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatAuditCards } from "./shared.js";

export type RunAuditLastInput = {
  projectName: string;
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

export async function runAuditLast(input: RunAuditLastInput): Promise<0 | 1> {
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
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    // Newest session by startedAt (Session has startedAt, not createdAt).
    const sessions = [...registry.listSessions(project.id)].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
    const newest = sessions[0];
    const now = input.now ?? (() => new Date().toISOString());
    if (!newest) {
      const summary = summarizeAudit([], { window: "session", now });
      if (input.json) input.stdout(JSON.stringify(summary));
      else for (const line of formatAuditCards(summary)) input.stdout(line);
      return 0;
    }
    const events = readAuditEvents({ root: rootDir }, project.id, newest.id);
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
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditLastCommand = defineCommand({
  meta: { name: "last", description: "Audit summary for the most recent session." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runAuditLast({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
