import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import {
  type ConnectorContext,
  assertProjectRoot,
  parseBlock,
  readTargetFile,
  renderBlock,
  upsertBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import type { MemoryEntry, Project, Session } from "@megasaver/core";
import { defineCommand } from "citty";
import { invalidTargetMessage, mapErrorToCliMessage, projectNotFoundMessage } from "../errors.js";
import {
  KNOWN_TARGETS,
  KNOWN_TARGET_IDS,
  type KnownTargetId,
  isKnownTargetId,
} from "../known-targets.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";
import { projectNameSchema } from "./shared/schemas.js";

const TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map((t) => t.id.length));

function formatStatusLine(target: ConnectorTarget, status: string, session?: string): string {
  const base = `${target.id.padEnd(TARGET_ID_COLUMN_WIDTH, " ")}  ${target.relativePath}  ${status}`;
  return session === undefined ? base : `${base}  session=${session}`;
}

function pickLatestOpenSession(
  sessions: readonly Session[],
  agentId: ConnectorTarget["agentId"],
): Session | null {
  const candidates = sessions.filter((s) => s.endedAt === null && s.agentId === agentId);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    Date.parse(current.startedAt) > Date.parse(latest.startedAt) ? current : latest,
  );
}

function filterMemoryEntriesForSession(
  entries: readonly MemoryEntry[],
  session: Session | null,
): MemoryEntry[] {
  return entries.filter((entry) => {
    if (entry.scope === "project") return true;
    return session !== null && entry.sessionId === session.id;
  });
}

function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
  allMemoryEntries: readonly MemoryEntry[],
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  const memoryEntries = filterMemoryEntriesForSession(allMemoryEntries, session);
  return {
    agentId: target.agentId,
    project,
    session,
    memoryEntries,
  };
}

export type RunConnectorSyncInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runConnectorSync(input: RunConnectorSyncInput): Promise<0 | 1> {
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

  if (input.targetFlag !== undefined && !isKnownTargetId(input.targetFlag)) {
    const cli = invalidTargetMessage(input.targetFlag);
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

    try {
      await assertProjectRoot(project.rootPath);
    } catch (err) {
      const cli = mapErrorToCliMessage(err);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const sessions = registry.listSessions(project.id);
    const memoryEntries = registry.listMemoryEntries(project.id);
    let anyFailed = false;
    for (const target of KNOWN_TARGETS) {
      try {
        const absPath = join(project.rootPath, target.relativePath);
        const existing = await readTargetFile(absPath);

        if (existing === null && input.targetFlag !== target.id) {
          input.stdout(formatStatusLine(target, "skipped"));
          continue;
        }

        const context = buildConnectorContext(target, project, sessions, memoryEntries);

        if (existing === null) {
          const newContent = ("header" in target ? target.header : "") + renderBlock(context);
          await mkdir(dirname(absPath), { recursive: true });
          await writeTargetFile({ absPath, content: newContent });
          input.stdout(formatStatusLine(target, "created"));
          continue;
        }

        const newContent = upsertBlock({ existingContent: existing, context });
        if (newContent === existing) {
          input.stdout(formatStatusLine(target, "noop"));
          continue;
        }
        await writeTargetFile({ absPath, content: newContent });
        input.stdout(formatStatusLine(target, "wrote"));
      } catch (err) {
        anyFailed = true;
        input.stdout(formatStatusLine(target, "error"));
        const cli = mapErrorToCliMessage(err, {
          kind: "connector",
          targetId: target.id,
          relativePath: target.relativePath,
        });
        input.stderr(cli.message);
      }
    }
    return anyFailed ? 1 : 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const connectorSyncCommand = defineCommand({
  meta: { name: "sync", description: "Write Mega Saver context blocks into agent files." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    target: {
      type: "string",
      description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to seed when its file does not exist.`,
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runConnectorSync({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
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

export type RunConnectorStatusInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runConnectorStatus(input: RunConnectorStatusInput): Promise<0 | 1> {
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

  if (input.targetFlag !== undefined && !isKnownTargetId(input.targetFlag)) {
    const cli = invalidTargetMessage(input.targetFlag);
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

    try {
      await assertProjectRoot(project.rootPath);
    } catch (err) {
      const cli = mapErrorToCliMessage(err);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const targets =
      input.targetFlag === undefined
        ? KNOWN_TARGETS
        : KNOWN_TARGETS.filter((t) => t.id === input.targetFlag);

    const sessions = registry.listSessions(project.id);
    const memoryEntries = registry.listMemoryEntries(project.id);
    let anyDriftOrError = false;
    type StatusRecord = {
      id: string;
      relativePath: string;
      status: string;
      session: string | null;
    };
    const records: StatusRecord[] = [];
    for (const target of targets) {
      const session = pickLatestOpenSession(sessions, target.agentId);
      const sessionLabel = session === null ? "none" : session.id;
      try {
        const absPath = join(project.rootPath, target.relativePath);
        const existing = await readTargetFile(absPath);

        if (existing === null) {
          if (input.json) {
            records.push({
              id: target.id,
              relativePath: target.relativePath,
              status: "missing",
              session: null,
            });
          } else {
            input.stdout(formatStatusLine(target, "missing", sessionLabel));
          }
          continue;
        }

        const parsed = parseBlock(existing);
        if (parsed.block === null) {
          anyDriftOrError = true;
          if (input.json) {
            records.push({
              id: target.id,
              relativePath: target.relativePath,
              status: "no-block",
              session: session === null ? null : session.id,
            });
          } else {
            input.stdout(formatStatusLine(target, "no-block", sessionLabel));
          }
          continue;
        }

        const context = buildConnectorContext(target, project, sessions, memoryEntries);
        const upserted = upsertBlock({ existingContent: existing, context });
        if (upserted === existing) {
          if (input.json) {
            records.push({
              id: target.id,
              relativePath: target.relativePath,
              status: "in-sync",
              session: session === null ? null : session.id,
            });
          } else {
            input.stdout(formatStatusLine(target, "in-sync", sessionLabel));
          }
          continue;
        }
        anyDriftOrError = true;
        if (input.json) {
          records.push({
            id: target.id,
            relativePath: target.relativePath,
            status: "drift",
            session: session === null ? null : session.id,
          });
        } else {
          input.stdout(formatStatusLine(target, "drift", sessionLabel));
        }
      } catch (err) {
        anyDriftOrError = true;
        if (input.json) {
          records.push({
            id: target.id,
            relativePath: target.relativePath,
            status: "error",
            session: session === null ? null : session.id,
          });
        } else {
          input.stdout(formatStatusLine(target, "error", sessionLabel));
        }
        const cli = mapErrorToCliMessage(err, {
          kind: "connector",
          targetId: target.id,
          relativePath: target.relativePath,
        });
        input.stderr(cli.message);
      }
    }
    if (input.json) {
      input.stdout(JSON.stringify(records));
    }
    return anyDriftOrError ? 1 : 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const connectorStatusCommand = defineCommand({
  meta: { name: "status", description: "Report per-target sync state without writing." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    target: {
      type: "string",
      description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the report.`,
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", description: "Emit machine-readable JSON array." },
  },
  async run({ args }) {
    const code = await runConnectorStatus({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      json: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
    status: connectorStatusCommand,
  },
});
