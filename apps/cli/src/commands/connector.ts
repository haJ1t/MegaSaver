import { join } from "node:path";
import { type ConnectorTarget, codexTarget } from "@megasaver/connector-generic-cli";
import {
  type ConnectorContext,
  assertConnectorContext,
  assertProjectRoot,
  readTargetFile,
  renderBlock,
  upsertBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import type { Project, Session } from "@megasaver/core";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  invalidTargetMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
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

// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts.
const KNOWN_TARGET_IDS = ["claude-code", "codex"] as const;
type KnownTargetId = (typeof KNOWN_TARGET_IDS)[number];

function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}

const CLAUDE_CODE_TARGET: ConnectorTarget = {
  id: "claude-code",
  agentId: "claude-code",
  relativePath: "CLAUDE.md",
};

const KNOWN_TARGETS: readonly ConnectorTarget[] = [CLAUDE_CODE_TARGET, codexTarget];

const TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map((t) => t.id.length));

function formatStatusLine(target: ConnectorTarget, status: string): string {
  return `${target.id.padEnd(TARGET_ID_COLUMN_WIDTH, " ")}  ${target.relativePath}  ${status}`;
}

function pickLatestOpenSession(
  sessions: readonly Session[],
  agentId: ConnectorTarget["agentId"],
): Session | null {
  const candidates = sessions.filter((s) => s.endedAt === null && s.agentId === agentId);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    current.startedAt > latest.startedAt ? current : latest,
  );
}

function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  return assertConnectorContext({
    agentId: target.agentId,
    project,
    session,
    memoryEntries: [],
  });
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

    for (const target of KNOWN_TARGETS) {
      const absPath = join(project.rootPath, target.relativePath);
      const existing = await readTargetFile(absPath);

      if (existing === null && input.targetFlag !== target.id) {
        input.stdout(formatStatusLine(target, "skipped"));
        continue;
      }

      if (existing === null) {
        // --target flag matched; seed the file with a fresh block.
        const context = buildConnectorContext(target, project, registry.listSessions(project.id));
        const newContent = renderBlock(context);
        await writeTargetFile({ absPath, content: newContent });
        input.stdout(formatStatusLine(target, "created"));
        continue;
      }

      const context = buildConnectorContext(target, project, registry.listSessions(project.id));
      const newContent = upsertBlock({ existingContent: existing, context });
      if (newContent === existing) {
        input.stdout(formatStatusLine(target, "noop"));
        continue;
      }
      await writeTargetFile({ absPath, content: newContent });
      input.stdout(formatStatusLine(target, "wrote"));
    }
    return 0;
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
      description: "Optional target id to seed when its file does not exist.",
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

export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
  },
});
