import { constants, access } from "node:fs/promises";
import { dirname, join, parse as parsePath } from "node:path";
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
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type DoctorRecord = {
  id: string;
  relativePath: string;
  status: string;
  writable: boolean;
  session: string | null;
};

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// For an absent target file, writability is probed on the nearest existing
// ancestor directory (spec §5b): a sync would create the file there, so a
// non-writable ancestor is the actionable defect, not the missing file itself.
async function isAncestorWritable(absPath: string): Promise<boolean> {
  let dir = dirname(absPath);
  const { root } = parsePath(dir);
  while (true) {
    if (await isWritable(dir)) return true;
    try {
      await access(dir, constants.F_OK);
      // Directory exists but is not writable — that is the defect.
      return false;
    } catch {
      // Directory does not exist yet; walk up to the nearest existing ancestor.
    }
    if (dir === root) return false;
    dir = dirname(dir);
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
  const now = new Date().toISOString();
  let anyError = false;
  const records: DoctorRecord[] = [];

  const emit = (
    target: (typeof targets)[number],
    status: string,
    writable: boolean,
    sessionId: string | null,
  ) => {
    if (input.json) {
      records.push({
        id: target.id,
        relativePath: target.relativePath,
        status,
        writable,
        session: sessionId,
      });
    } else {
      input.stdout(formatStatusLine(target, status, sessionId ?? "none"));
    }
  };

  for (const target of targets) {
    const session = pickLatestOpenSession(sessions, target.agentId);
    const sessionId = session === null ? null : session.id;
    const absPath = join(project.rootPath, target.relativePath);
    const existing = await readTargetFile(absPath);

    if (existing === null) {
      // Absent file: a sync would create it, so probe the parent directory.
      const writable = await isAncestorWritable(absPath);
      if (!writable) {
        anyError = true;
        emit(target, "not-writable", false, sessionId);
        continue;
      }
      emit(target, "missing", true, sessionId);
      continue;
    }

    const writable = await isWritable(absPath);
    if (!writable) {
      anyError = true;
      emit(target, "not-writable", false, sessionId);
      continue;
    }

    const parsed = parseBlock(existing);
    if (parsed.block === null) {
      emit(target, "no-block", true, sessionId);
      continue;
    }

    const context = buildConnectorContext(target, project, sessions, memoryEntries, now);
    const upserted = upsertBlock({ existingContent: existing, context });
    if (normalizeEol(upserted) === normalizeEol(existing)) {
      emit(target, "ok", true, sessionId);
    } else {
      anyError = true;
      emit(target, "stale", true, sessionId);
    }
  }

  if (input.json) input.stdout(JSON.stringify(records));
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
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runConnectorDoctor({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
