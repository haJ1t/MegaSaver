import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ChunkSetSummary,
  listChunkSets,
  listOverlayChunkSets,
} from "@megasaver/content-store";
import { hashPath, loadReadIndex, type ReadIndexEntry } from "@megasaver/context-gate";
import { readOverlaySummary, readOverlaySummaryAnyWorkspace, readSummary } from "@megasaver/core";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey, sessionIdSchema } from "@megasaver/shared";
import { readLatestIntentRecord } from "../../hooks/intent-run.js";
import { ensureStoreReady } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";

export const RESUME_LIVE_WINDOW_MS = 10 * 60_000;

export type ResumeFreshness = "unchanged" | "changed" | "missing" | "unknown";

export type ResumeFilePointer = {
  path: string;
  chunkSetId: string;
  chunkCount: number;
  createdAt: string;
  freshness: ResumeFreshness;
};

export type ResumeOutputPointer = {
  kind: "command" | "grep" | "fetch";
  label: string; // redacted
  chunkSetId: string;
  chunkCount: number;
  createdAt: string;
};

export type ResumeStatsLine = {
  eventsTotal: number;
  rawBytesTotal: number;
  returnedBytesTotal: number;
  savingRatio: number;
} | null;

export type ResumeTarget =
  | {
      layout: "registry";
      sessionId: string;
      projectName: string;
      agentId: string;
      title: string | null;
      startedAt: string;
      endedAt: string | null;
      workspaceKey: string; // encodeWorkspaceKey(project.rootPath)
      sessionDir: string; // <store>/content/<projectId>/<sessionId>
      projectId: string;
    }
  | {
      layout: "overlay";
      sessionId: string; // liveSessionId
      workspaceKey: string;
      updatedAt: string;
      sessionDir: string; // <store>/content/<workspaceKey>/<liveSessionId>
    };

export type ResumeLiveness =
  | { verdict: "live"; source: "mesh" }
  | { verdict: "recently-active"; source: "activity" }
  | { verdict: "presumed-dead"; source: "activity" };

export type ResumeSources = {
  target: ResumeTarget;
  lastActivityAt: string | null;
  liveness: ResumeLiveness;
  intent: { prompt: string; ts: number } | null;
  files: readonly ResumeFilePointer[];
  outputs: readonly ResumeOutputPointer[];
  stats: ResumeStatsLine;
  omissions: readonly string[];
};

export function readMeshPresenceLastSeenMs(
  storeRoot: string,
  liveSessionId: string,
): number | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(storeRoot, "mesh", "presence", `${liveSessionId}.json`), "utf8"),
    ) as { lastSeenAt?: unknown };
    if (typeof raw.lastSeenAt !== "string") return null;
    const ms = Date.parse(raw.lastSeenAt);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export async function resolveResumeTarget(input: {
  storeRoot: string;
  sessionId: string;
}): Promise<ResumeTarget | null> {
  const { storeRoot, sessionId } = input;
  const { registry } = await ensureStoreReady(storeRoot);

  if (sessionIdSchema.safeParse(sessionId).success) {
    try {
      const session = registry.getSession(sessionId);
      if (session) {
        const project = registry.getProject(session.projectId);
        if (project) {
          return {
            layout: "registry",
            sessionId: session.id,
            projectName: project.name,
            agentId: session.agentId,
            title: session.title ?? null,
            startedAt: session.startedAt,
            endedAt: session.endedAt ?? null,
            workspaceKey: encodeWorkspaceKey(project.rootPath),
            sessionDir: join(storeRoot, "content", project.id, session.id),
            projectId: project.id,
          };
        }
      }
    } catch {
      // not in registry, fall through to overlay
    }
  }

  const overlay = readOverlaySummaryAnyWorkspace({ root: storeRoot }, sessionId);
  if (overlay !== null) {
    return {
      layout: "overlay",
      sessionId: overlay.summary.liveSessionId,
      workspaceKey: overlay.workspaceKey,
      updatedAt: overlay.summary.updatedAt,
      sessionDir: join(storeRoot, "content", overlay.workspaceKey, overlay.summary.liveSessionId),
    };
  }

  return null;
}

export async function resolveLastResumeTarget(input: {
  storeRoot: string;
  cwd: string;
}): Promise<ResumeTarget | null> {
  const { storeRoot, cwd } = input;
  const { registry } = await ensureStoreReady(storeRoot);
  const candidates: Array<{ target: ResumeTarget; activityAt: string }> = [];

  // 1. Registry sessions for matching project
  const project = findProjectByCwd(registry.listProjects(), cwd);
  if (project) {
    try {
      const sessions = registry.listSessions(project.id);
      for (const s of sessions) {
        candidates.push({
          target: {
            layout: "registry",
            sessionId: s.id,
            projectName: project.name,
            agentId: s.agentId,
            title: s.title ?? null,
            startedAt: s.startedAt,
            endedAt: s.endedAt ?? null,
            workspaceKey: encodeWorkspaceKey(project.rootPath),
            sessionDir: join(storeRoot, "content", project.id, s.id),
            projectId: project.id,
          },
          activityAt: s.endedAt ?? s.startedAt,
        });
      }
    } catch {
      // ignore
    }
  }

  // 2. Overlay sessions for workspace key
  const wk = encodeWorkspaceKey(cwd);
  const statsDir = join(storeRoot, "stats", wk);
  if (existsSync(statsDir)) {
    try {
      const entries = readdirSync(statsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        if (
          entry.name.endsWith(".events.jsonl") ||
          entry.name === "session-intent.json" ||
          entry.name === "resume-capsule.json" ||
          entry.name === "workspace-token-saver.json" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }
        const liveSessionId = entry.name.slice(0, -5);
        const summary = readOverlaySummary({ root: storeRoot }, wk, liveSessionId);
        if (summary) {
          candidates.push({
            target: {
              layout: "overlay",
              sessionId: summary.liveSessionId,
              workspaceKey: wk,
              updatedAt: summary.updatedAt,
              sessionDir: join(storeRoot, "content", wk, summary.liveSessionId),
            },
            activityAt: summary.updatedAt,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const diff = Date.parse(b.activityAt) - Date.parse(a.activityAt);
    if (diff !== 0) return diff;
    return a.target.sessionId.localeCompare(b.target.sessionId);
  });

  const firstCandidate = candidates[0];
  return firstCandidate ? firstCandidate.target : null;
}

function classifyFreshness(
  summary: ChunkSetSummary,
  readIndex: Record<string, ReadIndexEntry>,
): ResumeFreshness {
  if (summary.source.kind !== "file") return "unknown";
  const filePath = summary.source.path;
  if (!existsSync(filePath)) return "missing";
  let content: Buffer;
  try {
    content = readFileSync(filePath);
  } catch {
    return "missing";
  }
  const currentHash = createHash("sha256").update(content).digest("hex");
  const byChunkSet = Object.values(readIndex).find((e) => e.chunkSetId === summary.chunkSetId);
  const byPath = readIndex[hashPath(filePath)];
  const entry = byChunkSet ?? byPath;
  if (!entry) return "unknown";
  return entry.contentHash === currentHash ? "unchanged" : "changed";
}

function outputLabelOf(source: ChunkSetSummary["source"], chunkSetId: string): string {
  if (source.kind === "command") {
    const full = [source.command, ...source.args].join(" ").trim();
    return redact(full.length > 0 ? full : source.command).redacted;
  }
  if (source.kind === "grep") {
    return redact(source.query).redacted;
  }
  if (source.kind === "fetch") {
    return redact(source.url).redacted;
  }
  return redact(chunkSetId).redacted;
}

function deriveLastActivityAt(
  target: ResumeTarget,
  summaries: readonly ChunkSetSummary[],
): string | null {
  if (target.layout === "overlay") {
    return target.updatedAt;
  }
  if (target.endedAt !== null) {
    return target.endedAt;
  }
  if (summaries.length > 0) {
    let newest = summaries[0]?.createdAt ?? target.startedAt;
    for (const s of summaries) {
      if (Date.parse(s.createdAt) > Date.parse(newest)) {
        newest = s.createdAt;
      }
    }
    return newest;
  }
  return target.startedAt;
}

export async function gatherResumeSources(input: {
  storeRoot: string;
  target: ResumeTarget;
  nowMs: number;
}): Promise<ResumeSources> {
  const { storeRoot, target, nowMs } = input;
  const omissions: string[] = [];

  let summaries: readonly ChunkSetSummary[] = [];
  try {
    summaries =
      target.layout === "registry"
        ? await listChunkSets({
            storeRoot,
            projectId: target.projectId,
            sessionId: target.sessionId,
          })
        : await listOverlayChunkSets({
            storeRoot,
            workspaceKey: target.workspaceKey,
            liveSessionId: target.sessionId,
          });
  } catch {
    omissions.push("(chunk sets unreadable)");
  }

  const index = loadReadIndex(target.sessionDir);
  const files: ResumeFilePointer[] = [];
  const outputs: ResumeOutputPointer[] = [];

  const sortedSummaries = [...summaries].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  for (const summary of sortedSummaries) {
    if (summary.source.kind === "file") {
      files.push({
        path: summary.source.path,
        chunkSetId: summary.chunkSetId,
        chunkCount: summary.chunkCount,
        createdAt: summary.createdAt,
        freshness: classifyFreshness(summary, index),
      });
    } else {
      const kind: "command" | "grep" | "fetch" =
        summary.source.kind === "fetch"
          ? "fetch"
          : summary.source.kind === "grep"
            ? "grep"
            : "command";
      outputs.push({
        kind,
        label: outputLabelOf(summary.source, summary.chunkSetId),
        chunkSetId: summary.chunkSetId,
        chunkCount: summary.chunkCount,
        createdAt: summary.createdAt,
      });
    }
  }

  let stats: ResumeStatsLine = null;
  try {
    const rawStats =
      target.layout === "registry"
        ? readSummary({ root: storeRoot }, target.projectId, target.sessionId)
        : readOverlaySummary({ root: storeRoot }, target.workspaceKey, target.sessionId);
    if (rawStats) {
      stats = {
        eventsTotal: rawStats.eventsTotal,
        rawBytesTotal: rawStats.rawBytesTotal,
        returnedBytesTotal: rawStats.returnedBytesTotal,
        savingRatio: rawStats.savingRatio,
      };
    }
  } catch {
    stats = null;
  }
  if (stats === null) omissions.push("(no stats recorded)");

  let intent: { prompt: string; ts: number } | null = null;
  try {
    const record = readLatestIntentRecord(storeRoot, target.workspaceKey, target.sessionId);
    if (record) {
      intent = { prompt: record.prompt, ts: record.ts };
    }
  } catch {
    intent = null;
  }
  if (intent === null) omissions.push("(no captured intent)");

  const lastActivityAt = deriveLastActivityAt(target, summaries);
  const meshLastSeenMs =
    target.layout === "overlay" ? readMeshPresenceLastSeenMs(storeRoot, target.sessionId) : null;
  const liveness: ResumeLiveness =
    meshLastSeenMs !== null && nowMs - meshLastSeenMs < RESUME_LIVE_WINDOW_MS
      ? { verdict: "live", source: "mesh" }
      : lastActivityAt !== null && nowMs - Date.parse(lastActivityAt) < RESUME_LIVE_WINDOW_MS
        ? { verdict: "recently-active", source: "activity" }
        : { verdict: "presumed-dead", source: "activity" };

  return { target, lastActivityAt, liveness, intent, files, outputs, stats, omissions };
}
