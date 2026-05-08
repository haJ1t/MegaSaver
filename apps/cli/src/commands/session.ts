import { randomUUID } from "node:crypto";
import { CoreRegistryError } from "@megasaver/core";
import { agentIdSchema, riskLevelSchema, sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  invalidAgentMessage,
  invalidRiskMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
  sessionAlreadyEndedMessage,
  sessionNotFoundMessage,
} from "../errors.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";

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
      description: "Agent id (claude-code | codex | generic-cli).",
    },
    risk: {
      type: "string",
      description: "Risk level (low | medium | high | critical). Default: medium.",
    },
    title: { type: "string", description: "Optional session title." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const newIdEnv =
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      typeof process.env["MEGA_TEST_SESSION_ID"] === "string"
        ? // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          process.env["MEGA_TEST_SESSION_ID"]
        : undefined;
    const nowEnv =
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      typeof process.env["MEGA_TEST_NOW"] === "string"
        ? // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          process.env["MEGA_TEST_NOW"]
        : undefined;
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

function formatSessionLine(session: {
  id: string;
  agentId: string;
  riskLevel: string;
  title: string | null;
}): string {
  return `${session.id}  ${session.agentId}  ${session.riskLevel}  ${session.title ?? "-"}`;
}

export type RunSessionListInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionList(input: RunSessionListInput): Promise<0 | 1> {
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
    const sessions = registry.listSessions(project.id);
    for (const session of sessions) {
      input.stdout(formatSessionLine(session));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionListCommand = defineCommand({
  meta: { name: "list", description: "List sessions for a project." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name to filter by.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionList({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

const SHOW_KEY_WIDTH = 12;

function formatShowLines(session: {
  id: string;
  projectId: string;
  agentId: string;
  riskLevel: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
}): string[] {
  const pairs: Array<[string, string]> = [
    ["id", session.id],
    ["project", session.projectId],
    ["agent", session.agentId],
    ["risk", session.riskLevel],
    ["title", session.title ?? "-"],
    ["startedAt", session.startedAt],
    ["endedAt", session.endedAt ?? "-"],
  ];
  return pairs.map(([key, value]) => `${key.padEnd(SHOW_KEY_WIDTH, " ")}${value}`);
}

export type RunSessionShowInput = {
  sessionId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionShow(input: RunSessionShowInput): Promise<0 | 1> {
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

  let id: ReturnType<typeof sessionIdSchema.parse>;
  try {
    id = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const session = registry.getSession(id);
    if (!session) {
      const cli = sessionNotFoundMessage(id);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    for (const line of formatShowLines(session)) {
      input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionShowCommand = defineCommand({
  meta: { name: "show", description: "Show a session's full details." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionShow({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export type RunSessionEndInput = {
  sessionId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};

export async function runSessionEnd(input: RunSessionEndInput): Promise<0 | 1> {
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

  let id: ReturnType<typeof sessionIdSchema.parse>;
  try {
    id = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const existing = registry.getSession(id);
    if (!existing) {
      const cli = sessionNotFoundMessage(id);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (existing.endedAt !== null) {
      const cli = sessionAlreadyEndedMessage(id, existing.endedAt);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const endedAt = (input.now ?? (() => new Date().toISOString()))();
    try {
      registry.endSession(id, { endedAt });
    } catch (err) {
      if (err instanceof CoreRegistryError && err.code === "session_already_ended") {
        // Race with concurrent process: refresh and format the rich message.
        const refreshed = registry.getSession(id);
        const ts = refreshed?.endedAt ?? "unknown";
        const cli = sessionAlreadyEndedMessage(id, ts);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      throw err;
    }
    input.stdout(id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionEndCommand = defineCommand({
  meta: { name: "end", description: "Mark a session as ended." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const nowEnv =
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      typeof process.env["MEGA_TEST_NOW"] === "string"
        ? // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          process.env["MEGA_TEST_NOW"]
        : undefined;
    const code = await runSessionEnd({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      ...(nowEnv !== undefined ? { now: () => nowEnv } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
    list: sessionListCommand,
    show: sessionShowCommand,
    end: sessionEndCommand,
  },
});
