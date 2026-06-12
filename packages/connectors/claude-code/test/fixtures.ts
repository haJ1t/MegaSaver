import type { MemoryEntry, Project, Session } from "@megasaver/core";
import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";

const projectId = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const sessionId = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const projectMemoryId = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const sessionMemoryId = memoryEntryIdSchema.parse("44444444-4444-4444-8444-444444444444");

export const project: Project = {
  id: projectId,
  name: "Mega Saver",
  rootPath: "/tmp/mega-saver",
  createdAt: "2026-05-06T10:00:00.000Z",
  updatedAt: "2026-05-06T10:00:00.000Z",
};

export const session: Session = {
  id: sessionId,
  projectId,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "Connector implementation",
  startedAt: "2026-05-06T10:01:00.000Z",
  endedAt: null,
};

export const projectMemory: MemoryEntry = {
  id: projectMemoryId,
  projectId,
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "Project-level convention",
  content: "Project-level convention for Claude Code.",
  keywords: [],
  confidence: "medium",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: "2026-05-06T10:02:00.000Z",
  updatedAt: "2026-05-06T10:02:00.000Z",
};

export const sessionMemory: MemoryEntry = {
  id: sessionMemoryId,
  projectId,
  sessionId,
  scope: "session",
  type: "decision",
  title: "Session-specific context",
  content: "Session-specific context for Claude Code.",
  keywords: [],
  confidence: "medium",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: "2026-05-06T10:03:00.000Z",
  updatedAt: "2026-05-06T10:03:00.000Z",
};
