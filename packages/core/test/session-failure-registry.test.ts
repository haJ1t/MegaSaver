import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT = "11111111-1111-4111-8111-111111111111" as never;
const SESSION = "22222222-2222-4222-8222-222222222222" as never;
const TS = "2026-07-01T00:00:00.000Z";

function seed() {
  const r = createInMemoryCoreRegistry();
  r.createProject({
    id: PROJECT,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  r.createSession({
    id: SESSION,
    projectId: PROJECT,
    agentId: "claude-code" as never,
    riskLevel: "medium",
    title: null,
    startedAt: TS,
    endedAt: null,
  });
  return r;
}

describe("session failure registry", () => {
  it("creates and lists session failures scoped to a session", () => {
    const r = seed();
    r.createSessionFailure({
      id: "33333333-3333-4333-8333-333333333333" as never,
      projectId: PROJECT,
      sessionId: SESSION,
      command: "pnpm test",
      errorOutput: "boom",
      source: "proxy-classifier",
      createdAt: TS,
    });
    const list = r.listSessionFailures(PROJECT, SESSION);
    expect(list).toHaveLength(1);
    expect(list[0]?.errorOutput).toBe("boom");
  });

  it("clears session failures on endSession", () => {
    const r = seed();
    r.createSessionFailure({
      id: "33333333-3333-4333-8333-333333333334" as never,
      projectId: PROJECT,
      sessionId: SESSION,
      command: "x",
      errorOutput: "boom",
      source: "proxy-classifier",
      createdAt: TS,
    });
    r.endSession(SESSION, { endedAt: TS });
    expect(r.listSessionFailures(PROJECT, SESSION)).toHaveLength(0);
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});
function createTempRoot(): string {
  const root = join(tmpdir(), `megasaver-session-failure-${randomUUID()}`);
  roots.push(root);
  return root;
}
function seedJson(root: string) {
  const r = createJsonDirectoryCoreRegistry({ rootDir: root });
  r.createProject({
    id: PROJECT,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  r.createSession({
    id: SESSION,
    projectId: PROJECT,
    agentId: "claude-code" as never,
    riskLevel: "medium",
    title: null,
    startedAt: TS,
    endedAt: null,
  });
  return r;
}

describe("session failure registry (json-directory)", () => {
  it("persists session failures across a re-open", () => {
    const root = createTempRoot();
    const r = seedJson(root);
    r.createSessionFailure({
      id: "33333333-3333-4333-8333-333333333333" as never,
      projectId: PROJECT,
      sessionId: SESSION,
      command: "pnpm test",
      errorOutput: "boom",
      source: "proxy-classifier",
      createdAt: TS,
    });

    const reopened = createJsonDirectoryCoreRegistry({ rootDir: root });
    const list = reopened.listSessionFailures(PROJECT, SESSION);
    expect(list).toHaveLength(1);
    expect(list[0]?.errorOutput).toBe("boom");
  });

  it("clears session failures on endSession across a re-open", () => {
    const root = createTempRoot();
    const r = seedJson(root);
    r.createSessionFailure({
      id: "33333333-3333-4333-8333-333333333334" as never,
      projectId: PROJECT,
      sessionId: SESSION,
      command: "x",
      errorOutput: "boom",
      source: "proxy-classifier",
      createdAt: TS,
    });
    r.endSession(SESSION, { endedAt: TS });

    const reopened = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(reopened.listSessionFailures(PROJECT, SESSION)).toHaveLength(0);
  });
});
