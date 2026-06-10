import { randomUUID } from "node:crypto";
import { agentIdSchema, riskLevelSchema, sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  invalidAgentMessage,
  invalidRiskMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { readTestEnv, titleSchema } from "./shared.js";

export type RunSessionCreateInput = {
  projectName: string;
  agent: string;
  risk: string;
  title: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};

export async function runSessionCreate(input: RunSessionCreateInput): Promise<0 | 1> {
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

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let agentId: ReturnType<typeof agentIdSchema.parse>;
  try {
    agentId = agentIdSchema.parse(input.agent);
  } catch {
    const cli = invalidAgentMessage(input.agent);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let riskLevel: ReturnType<typeof riskLevelSchema.parse>;
  try {
    riskLevel = riskLevelSchema.parse(input.risk);
  } catch {
    const cli = invalidRiskMessage(input.risk);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let title: string | null = null;
  if (input.title !== undefined) {
    try {
      title = titleSchema.parse(input.title);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "title" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const sessionId = sessionIdSchema.parse((input.newId ?? randomUUID)());
    const startedAt = (input.now ?? (() => new Date().toISOString()))();
    // Trust-boundary: Core validates the session object internally; no re-parse
    // needed here because session fields are only displayed (not written to agent files).
    const created = registry.createSession({
      id: sessionId,
      projectId: project.id,
      agentId,
      riskLevel,
      title,
      startedAt,
      endedAt: null,
    });
    input.stdout(input.json ? JSON.stringify(created) : created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a new session." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    agent: {
      type: "string",
      required: true,
      description: `Agent id (${agentIdSchema.options.join(" | ")}).`,
    },
    risk: {
      type: "string",
      description: `Risk level (${riskLevelSchema.options.join(" | ")}). Default: medium.`,
    },
    title: { type: "string", description: "Optional session title." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const newIdEnv = readTestEnv("MEGA_TEST_SESSION_ID");
    const nowEnv = readTestEnv("MEGA_TEST_NOW");
    const code = await runSessionCreate({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      agent: typeof args.agent === "string" ? args.agent : "",
      risk: typeof args.risk === "string" ? args.risk : "medium",
      title: typeof args.title === "string" ? args.title : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
      ...(newIdEnv !== undefined ? { newId: () => newIdEnv } : {}),
      ...(nowEnv !== undefined ? { now: () => nowEnv } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
