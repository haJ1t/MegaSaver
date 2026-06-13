import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";

const PROJECT_ID_A = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const PROJECT_ID_B = projectIdSchema.parse("44444444-4444-4444-8444-444444444444");
const SESSION_ID_A = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const MEMORY_ENTRY_ID_A = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const roots: string[] = [];
const projectA = {
  id: PROJECT_ID_A,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: "2026-05-04T12:00:00.000Z",
  updatedAt: "2026-05-04T12:05:00.000Z",
};
const projectB = {
  ...projectA,
  id: PROJECT_ID_B,
  name: "Another Project",
  rootPath: "/tmp/another",
};
const sessionA = {
  id: SESSION_ID_A,
  projectId: PROJECT_ID_A,
  agentId: "claude-code",
  riskLevel: "high",
  title: "Core package",
  startedAt: "2026-05-04T12:10:00.000Z",
  endedAt: null,
} as const;
const mismatchedSessionMemory = {
  id: MEMORY_ENTRY_ID_A,
  projectId: PROJECT_ID_B,
  sessionId: SESSION_ID_A,
  scope: "session",
  type: "decision",
  title: "Cross-project memory",
  content: "Session belongs to a different project.",
  keywords: [],
  confidence: "medium",
  source: "manual",
  stale: false,
  createdAt: "2026-05-04T12:30:00.000Z",
  updatedAt: "2026-05-04T12:30:00.000Z",
} as const;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = join(tmpdir(), `megasaver-json-store-integrity-${randomUUID()}`);
  roots.push(root);
  return root;
}

function expectRegistryError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(CoreRegistryError);
  expect((thrown as CoreRegistryError).code).toBe(code);
}

describe("createJsonDirectoryCoreRegistry persistence integrity", () => {
  it("rejects session-scoped memory when the session belongs to another project", () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: makeRoot() });
    registry.createProject(projectA);
    registry.createProject(projectB);
    registry.createSession(sessionA);

    expectRegistryError(
      () => registry.createMemoryEntry(mismatchedSessionMemory),
      "session_project_mismatch",
    );
  });
});
