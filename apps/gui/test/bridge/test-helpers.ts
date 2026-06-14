import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ChunkSet } from "@megasaver/content-store";
import {
  type CoreRegistry,
  type MemoryEntry,
  type Project,
  type Session,
  createInMemoryCoreRegistry,
} from "@megasaver/core";
import type { SessionTokenSaverStats, TokenSaverEvent } from "@megasaver/stats";
import { createBridgeHandler } from "../../bridge/handler.js";

export type TestServer = {
  baseUrl: string;
  registry: CoreRegistry;
  storePath: string;
  close(): Promise<void>;
};

export type StoreSeed = {
  summaries?: { projectId: string; sessionId: string; summary: SessionTokenSaverStats }[];
  events?: { projectId: string; sessionId: string; lines: (TokenSaverEvent | string)[] }[];
  chunkSets?: { projectId: string; sessionId: string; chunkSet: ChunkSet }[];
  // Phase 3 workspace overlay layout (keyed by workspaceKey, not projectId).
  workspaceRules?: { workspaceKey: string; lines: unknown[] }[];
  workspaceTools?: { workspaceKey: string; lines: unknown[] }[];
  workspaceIndex?: {
    workspaceKey: string;
    blocks: unknown[];
    manifest?: { files: Record<string, { fileHash: string; blockIds: string[] }> };
  }[];
  // Phase 4 session-scoped overlay layout (keyed by workspaceKey/liveSessionId).
  overlayMemory?: { workspaceKey: string; lines: unknown[] }[];
  overlayTasks?: { workspaceKey: string; liveSessionId: string | null; lines: unknown[] }[];
  overlaySummaries?: { workspaceKey: string; liveSessionId: string; summary: unknown }[];
  overlayEvents?: { workspaceKey: string; liveSessionId: string; lines: (unknown | string)[] }[];
  overlayChunkSets?: {
    workspaceKey: string;
    liveSessionId: string;
    chunkSetId: string;
    chunkSet: unknown;
  }[];
};

function seedStore(root: string, seed: StoreSeed): void {
  for (const s of seed.summaries ?? []) {
    const p = join(root, "stats", s.projectId, `${s.sessionId}.json`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(s.summary));
  }
  for (const e of seed.events ?? []) {
    const p = join(root, "stats", e.projectId, `${e.sessionId}.events.jsonl`);
    mkdirSync(dirname(p), { recursive: true });
    const body = e.lines
      .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
      .join("\n");
    writeFileSync(p, `${body}\n`);
  }
  for (const c of seed.chunkSets ?? []) {
    const p = join(root, "content", c.projectId, c.sessionId, `${c.chunkSet.chunkSetId}.json`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(c.chunkSet));
  }
  for (const r of seed.workspaceRules ?? []) {
    seedJsonl(join(root, "rules", `${r.workspaceKey}.jsonl`), r.lines);
  }
  for (const t of seed.workspaceTools ?? []) {
    seedJsonl(join(root, "tools", `${t.workspaceKey}.jsonl`), t.lines);
  }
  for (const idx of seed.workspaceIndex ?? []) {
    const dir = join(root, "index", idx.workspaceKey);
    seedJsonl(join(dir, "blocks.jsonl"), idx.blocks);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      `${JSON.stringify(idx.manifest ?? { files: {} }, null, 2)}\n`,
    );
  }
  for (const m of seed.overlayMemory ?? []) {
    seedJsonl(join(root, "memory", `${m.workspaceKey}.jsonl`), m.lines);
  }
  for (const t of seed.overlayTasks ?? []) {
    const segment = t.liveSessionId ?? "_workspace";
    seedJsonl(join(root, "tasks", t.workspaceKey, `${segment}.jsonl`), t.lines);
  }
  for (const s of seed.overlaySummaries ?? []) {
    const p = join(root, "stats", s.workspaceKey, `${s.liveSessionId}.json`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(s.summary));
  }
  for (const e of seed.overlayEvents ?? []) {
    const p = join(root, "stats", e.workspaceKey, `${e.liveSessionId}.events.jsonl`);
    mkdirSync(dirname(p), { recursive: true });
    const body = e.lines
      .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
      .join("\n");
    writeFileSync(p, `${body}\n`);
  }
  for (const c of seed.overlayChunkSets ?? []) {
    const p = join(root, "content", c.workspaceKey, c.liveSessionId, `${c.chunkSetId}.json`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(c.chunkSet));
  }
}

function seedJsonl(filePath: string, lines: unknown[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length > 0 ? "\n" : ""),
  );
}

// Write a fake transcript + desktop metadata so listSessions resolves a live
// session whose projectLabel == cwd. Phase 3's permissions route derives the
// real cwd from this live workspace listing (the R4 "derived cache", never the
// URL), then reads <cwd>/.megasaver/permissions.yaml.
export function seedWorkspaceCwd(opts: {
  projectsDir: string;
  metaDir: string;
  cwd: string;
  id?: string;
}): void {
  const id = opts.id ?? "wssess01";
  const transcriptDir = join(opts.projectsDir, "ws-dir");
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(
    join(transcriptDir, `${id}.jsonl`),
    `${JSON.stringify({
      type: "user",
      timestamp: "2026-06-14T10:00:00.000Z",
      cwd: opts.cwd,
      message: { role: "user", content: "hi" },
    })}\n`,
  );
  const metaSubDir = join(opts.metaDir, "ws", "win");
  mkdirSync(metaSubDir, { recursive: true });
  writeFileSync(
    join(metaSubDir, `local_${id}.json`),
    JSON.stringify({
      cliSessionId: id,
      title: "Workspace session",
      cwd: opts.cwd,
      lastActivityAt: 1,
    }),
  );
}

export async function startTestBridge(seed?: {
  projects?: Project[];
  sessions?: Session[];
  memoryEntries?: MemoryEntry[];
  store?: StoreSeed;
  claudeProjectsDir?: string;
  claudeSessionsMetaDir?: string;
}): Promise<TestServer> {
  const registry = createInMemoryCoreRegistry();
  for (const project of seed?.projects ?? []) {
    registry.createProject(project);
  }
  for (const session of seed?.sessions ?? []) {
    registry.createSession(session);
  }
  for (const entry of seed?.memoryEntries ?? []) {
    registry.createMemoryEntry(entry);
  }

  const storePath = mkdtempSync(join(tmpdir(), "megasaver-gui-store-"));
  if (seed?.store) {
    seedStore(storePath, seed.store);
  }

  const handler = createBridgeHandler({
    registry,
    storePath,
    ...(seed?.claudeProjectsDir ? { claudeProjectsDir: seed.claudeProjectsDir } : {}),
    ...(seed?.claudeSessionsMetaDir ? { claudeSessionsMetaDir: seed.claudeSessionsMetaDir } : {}),
  });
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    registry,
    storePath,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          rmSync(storePath, { recursive: true, force: true });
          resolve();
        }),
      ),
  };
}

export const PROJECT_A: Project = {
  id: "11111111-1111-4111-8111-111111111111" as Project["id"],
  name: "alpha",
  rootPath: "/tmp/a",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

export const PROJECT_B: Project = {
  id: "22222222-2222-4222-8222-222222222222" as Project["id"],
  name: "beta",
  rootPath: "/tmp/b",
  createdAt: "2026-05-09T01:00:00.000Z",
  updatedAt: "2026-05-09T01:00:00.000Z",
};

export const SESSION_A_OPEN: Session = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as Session["id"],
  projectId: PROJECT_A.id,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "alpha-open",
  startedAt: "2026-05-10T11:00:00.000Z",
  endedAt: null,
};

export const SESSION_A_ENDED: Session = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as Session["id"],
  projectId: PROJECT_A.id,
  agentId: "codex",
  riskLevel: "high",
  title: "alpha-ended",
  startedAt: "2026-05-10T10:00:00.000Z",
  endedAt: "2026-05-10T11:30:00.000Z",
};

export const MEMORY_PROJECT_ENTRY: MemoryEntry = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as MemoryEntry["id"],
  projectId: PROJECT_A.id,
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "project memory in alpha",
  content: "project memory in alpha",
  keywords: [],
  confidence: "medium",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: "2026-05-10T11:15:00.000Z",
  updatedAt: "2026-05-10T11:15:00.000Z",
};
