import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type CoreRegistry,
  type MemoryEntry,
  type Project,
  type Session,
  createInMemoryCoreRegistry,
} from "@megasaver/core";
import { createBridgeHandler } from "../../bridge/handler.js";

export type TestServer = {
  baseUrl: string;
  registry: CoreRegistry;
  close(): Promise<void>;
};

export async function startTestBridge(seed?: {
  projects?: Project[];
  sessions?: Session[];
  memoryEntries?: MemoryEntry[];
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

  const handler = createBridgeHandler({ registry });
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    registry,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
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
  content: "project memory in alpha",
  createdAt: "2026-05-10T11:15:00.000Z",
};
