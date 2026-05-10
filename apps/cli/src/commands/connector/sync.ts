import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import {
  ConnectorError,
  readTargetFile,
  renderBlock,
  upsertBlock,
  writeTargetFile,
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

export type RunConnectorSyncInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

type SyncRecord = {
  id: string;
  relativePath: string;
  status: string;
  session: string | null;
};

export async function runConnectorSync(input: RunConnectorSyncInput): Promise<0 | 1> {
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
    const sessions = registry.listSessions(project.id);
    const memoryEntries = registry.listMemoryEntries(project.id);
    let anyFailed = false;
    const records: SyncRecord[] = [];
    const emit = (target: ConnectorTarget, status: string, sessionId: string | null) => {
      if (input.json) {
        records.push({
          id: target.id,
          relativePath: target.relativePath,
          status,
          session: sessionId,
        });
      } else {
        // T6 (full): every text-mode line carries session=<id|none>, matching
        // `connector status` output. Byte-compat break for non-error statuses
        // (skipped/created/noop/wrote) is intentional and documented.
        input.stdout(formatStatusLine(target, status, sessionId ?? "none"));
      }
    };
    for (const target of KNOWN_TARGETS) {
      const session = pickLatestOpenSession(sessions, target.agentId);
      const sessionId = session?.id ?? null;
      try {
        const absPath = join(project.rootPath, target.relativePath);
        const existing = await readTargetFile(absPath);

        if (existing === null && input.targetFlag !== target.id) {
          emit(target, "skipped", sessionId);
          continue;
        }

        const context = buildConnectorContext(target, project, sessions, memoryEntries);

        if (existing === null) {
          const newContent = ("header" in target ? target.header : "") + renderBlock(context);
          try {
            await mkdir(dirname(absPath), { recursive: true });
          } catch (mkdirErr) {
            throw new ConnectorError("file_write_failed", "Failed to create target directory.", {
              cause: mkdirErr,
              filePath: absPath,
            });
          }
          await writeTargetFile({ absPath, content: newContent });
          emit(target, "created", sessionId);
          continue;
        }

        const newContent = upsertBlock({ existingContent: existing, context });
        if (newContent === existing) {
          emit(target, "noop", sessionId);
          continue;
        }
        await writeTargetFile({ absPath, content: newContent });
        emit(target, "wrote", sessionId);
      } catch (err) {
        anyFailed = true;
        emit(target, "error", sessionId);
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
    json: { type: "boolean", default: false, description: "Emit JSON output." },
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
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
