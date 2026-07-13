import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import { type ConnectorContext, assertProjectRoot } from "@megasaver/connectors-shared";
import {
  type ChangedFrom,
  type CoreRegistry,
  type MemoryEntry,
  type Project,
  type Session,
  changedFromFor,
  isRecallable,
} from "@megasaver/core";
import {
  invalidTargetMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { KNOWN_TARGETS, isKnownTargetId } from "../../known-targets.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

export const TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map((t) => t.id.length));

export function formatStatusLine(
  target: ConnectorTarget,
  status: string,
  session?: string,
): string {
  const base = `${target.id.padEnd(TARGET_ID_COLUMN_WIDTH, " ")}  ${target.relativePath}  ${status}`;
  return session === undefined ? base : `${base}  session=${session}`;
}

export function pickLatestOpenSession(
  sessions: readonly Session[],
  agentId: ConnectorTarget["agentId"],
): Session | null {
  const candidates = sessions.filter((s) => s.endedAt === null && s.agentId === agentId);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    Date.parse(current.startedAt) > Date.parse(latest.startedAt) ? current : latest,
  );
}

export function filterMemoryEntriesForSession(
  entries: readonly MemoryEntry[],
  session: Session | null,
  now: string,
): MemoryEntry[] {
  return entries.filter((entry) => {
    // isRecallable (approved + current + non-archival) replaces the bare
    // approval check so closed (superseded) rows stop rendering — without
    // this a changedFrom line would co-render beside the very predecessor
    // it references (spec §3.3).
    if (!isRecallable(entry, now)) return false;
    if (entry.scope === "project") return true;
    return session !== null && entry.sessionId === session.id;
  });
}

export function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
  allMemoryEntries: readonly MemoryEntry[],
  now: string,
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  const filtered = filterMemoryEntriesForSession(allMemoryEntries, session, now);
  // connector block caps at 20 most-recent entries; older entries remain queryable via 'mega memory list'
  const memoryEntries = [...filtered]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 20);
  // changedFrom lookups go over the UNFILTERED list — the closed predecessor
  // is exactly the row filterMemoryEntriesForSession drops.
  const byId = new Map<string, MemoryEntry>(allMemoryEntries.map((m) => [m.id, m]));
  const memoryChangedFrom: Record<string, ChangedFrom> = {};
  for (const entry of memoryEntries) {
    const changedFrom = changedFromFor(entry, byId);
    if (changedFrom !== undefined) memoryChangedFrom[entry.id] = changedFrom;
  }
  return {
    agentId: target.agentId,
    project,
    session,
    memoryEntries,
    ...(Object.keys(memoryChangedFrom).length > 0 ? { memoryChangedFrom } : {}),
  };
}

export type ResolveProjectAndRootInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stderr: (line: string) => void;
};

export type ResolveProjectAndRootResult =
  | { ok: true; project: Project; registry: CoreRegistry }
  | { ok: false; exitCode: 0 | 1 };

/**
 * Shared prologue for `mega connector sync` and `mega connector status`.
 * On success, returns the resolved `project` and an open `registry` ready
 * for per-target work. On failure, emits the canonical error to stderr
 * (and the init notice when a fresh store was created) and returns the
 * exit code the caller should propagate.
 */
export async function resolveProjectAndRoot(
  input: ResolveProjectAndRootInput,
): Promise<ResolveProjectAndRootResult> {
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
    return { ok: false, exitCode: cli.exitCode };
  }

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return { ok: false, exitCode: cli.exitCode };
  }

  if (input.targetFlag !== undefined && !isKnownTargetId(input.targetFlag)) {
    const cli = invalidTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return { ok: false, exitCode: cli.exitCode };
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
      return { ok: false, exitCode: cli.exitCode };
    }

    try {
      await assertProjectRoot(project.rootPath);
    } catch (err) {
      const cli = mapErrorToCliMessage(err);
      input.stderr(cli.message);
      return { ok: false, exitCode: cli.exitCode };
    }

    return { ok: true, project, registry };
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return { ok: false, exitCode: cli.exitCode };
  }
}
