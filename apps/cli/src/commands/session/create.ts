import { randomUUID } from "node:crypto";
import { agentIdSchema, riskLevelSchema, sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  invalidAgentMessage,
  invalidRiskMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import { readTestEnv } from "./shared.js";

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  // C0/C1 control chars and DEL break the line-oriented output protocol.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

const titleSchema = z
  .string()
  .trim()
  .min(1)
  // Same C0/C1 + DEL guard as projectNameSchema — keeps line-oriented output safe.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

export type RunSessionCreateInput = {
  projectName: string;
  agent: string;
  risk: string;
  title: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
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
    const created = registry.createSession({
      id: sessionId,
      projectId: project.id,
      agentId,
      riskLevel,
      title,
      startedAt,
      endedAt: null,
    });
    input.stdout(created.id);
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
      // Keep in sync with agentIdSchema in @megasaver/shared.
      description: "Agent id (claude-code | codex | cursor | generic-cli).",
    },
    risk: {
      type: "string",
      description: "Risk level (low | medium | high | critical). Default: medium.",
    },
    title: { type: "string", description: "Optional session title." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const newIdEnv = readTestEnv("MEGA_TEST_SESSION_ID");
    const nowEnv = readTestEnv("MEGA_TEST_NOW");
    const code = await runSessionCreate({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      agent: typeof args.agent === "string" ? args.agent : "",
      risk: typeof args.risk === "string" ? args.risk : "medium",
      title: typeof args.title === "string" ? args.title : undefined,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      ...(newIdEnv !== undefined ? { newId: () => newIdEnv } : {}),
      ...(nowEnv !== undefined ? { now: () => nowEnv } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
