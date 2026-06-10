import { join } from "node:path";
import {
  normalizeEol,
  parseBlock,
  readTargetFile,
  upsertBlock,
} from "@megasaver/connectors-shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { KNOWN_TARGETS, KNOWN_TARGET_IDS } from "../../known-targets.js";
import {
  buildConnectorContext,
  formatStatusLine,
  pickLatestOpenSession,
  resolveProjectAndRoot,
} from "./shared.js";

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
  const resolved = await resolveProjectAndRoot({
    projectName: input.projectName,
    targetFlag: input.targetFlag,
    storeFlag: input.storeFlag,
    cwd: input.cwd,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
    stderr: input.stderr,
  });
  if (!resolved.ok) return resolved.exitCode;
  const { project, registry } = resolved;

  try {
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
        if (normalizeEol(upserted) === normalizeEol(existing)) {
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
    json: { type: "boolean", default: false, description: "Emit JSON output." },
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
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
