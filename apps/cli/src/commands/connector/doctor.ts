import { constants, access } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeEol,
  parseBlock,
  readTargetFile,
  upsertBlock,
} from "@megasaver/connectors-shared";
import { defineCommand } from "citty";
import { KNOWN_TARGETS, KNOWN_TARGET_IDS } from "../../known-targets.js";
import { readStoreEnv } from "../../store.js";
import {
  buildConnectorContext,
  formatStatusLine,
  pickLatestOpenSession,
  resolveProjectAndRoot,
} from "./shared.js";

export type RunConnectorDoctorInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runConnectorDoctor(input: RunConnectorDoctorInput): Promise<0 | 1> {
  const resolved = await resolveProjectAndRoot({
    projectName: input.projectName,
    targetFlag: input.targetFlag,
    storeFlag: input.storeFlag,
    cwd: input.cwd,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
    platform: input.platform,
    localAppData: input.localAppData,
    stderr: input.stderr,
  });
  if (!resolved.ok) return resolved.exitCode;
  const { project, registry } = resolved;

  const targets =
    input.targetFlag === undefined
      ? KNOWN_TARGETS
      : KNOWN_TARGETS.filter((t) => t.id === input.targetFlag);

  const sessions = registry.listSessions(project.id);
  const memoryEntries = registry.listMemoryEntries(project.id);
  let anyError = false;

  for (const target of targets) {
    const session = pickLatestOpenSession(sessions, target.agentId);
    const sessionLabel = session === null ? "none" : session.id;
    const absPath = join(project.rootPath, target.relativePath);
    const existing = await readTargetFile(absPath);

    if (existing === null) {
      input.stdout(formatStatusLine(target, "missing", sessionLabel));
      continue;
    }

    const writable = await isWritable(absPath);
    if (!writable) {
      anyError = true;
      input.stdout(formatStatusLine(target, "not-writable", sessionLabel));
      continue;
    }

    const parsed = parseBlock(existing);
    if (parsed.block === null) {
      input.stdout(formatStatusLine(target, "no-block", sessionLabel));
      continue;
    }

    const context = buildConnectorContext(target, project, sessions, memoryEntries);
    const upserted = upsertBlock({ existingContent: existing, context });
    if (normalizeEol(upserted) === normalizeEol(existing)) {
      input.stdout(formatStatusLine(target, "ok", sessionLabel));
    } else {
      anyError = true;
      input.stdout(formatStatusLine(target, "stale", sessionLabel));
    }
  }

  return anyError ? 1 : 0;
}

export const connectorDoctorCommand = defineCommand({
  meta: { name: "doctor", description: "Diagnose connector target health without writing." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    target: {
      type: "string",
      description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the check.`,
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runConnectorDoctor({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
