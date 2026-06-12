import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runConnectorSync } from "../src/commands/connector/sync.js";
import { runMemoryCreate } from "../src/commands/memory/create.js";
import { runSessionCreate } from "../src/commands/session/create.js";
import { runSessionEnd } from "../src/commands/session/end.js";
import { runSessionUpdate } from "../src/commands/session/update.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const MEMORY_ID = "33333333-3333-4333-8333-333333333333";
const TS = "2026-05-09T00:00:00.000Z";

describe("--json write-side success shape", () => {
  let store: string;
  let projectRoot: string;
  let stdoutLines: string[];
  let stderrLines: string[];

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-json-write-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-json-write-root-"));
    stdoutLines = [];
    stderrLines = [];
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function commonInput() {
    return {
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: (line: string) => stdoutLines.push(line),
      stderr: (line: string) => stderrLines.push(line),
    };
  }

  it("session create --json emits full Session", async () => {
    const code = await runSessionCreate({
      ...commonInput(),
      projectName: "demo",
      agent: "claude-code",
      risk: "medium",
      title: undefined,
      json: true,
      newId: () => SESSION_ID,
      now: () => TS,
    });
    expect(code).toBe(0);
    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: null,
      startedAt: TS,
      endedAt: null,
    });
  });

  it("session end --json emits ended Session", async () => {
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
    const code = await runSessionEnd({
      ...commonInput(),
      sessionId: SESSION_ID,
      json: true,
      now: () => "2026-05-09T01:00:00.000Z",
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutLines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({ id: SESSION_ID, endedAt: "2026-05-09T01:00:00.000Z" });
  });

  it("session update --json emits updated Session", async () => {
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
    const code = await runSessionUpdate({
      ...commonInput(),
      sessionId: SESSION_ID,
      titleFlag: "renamed",
      riskFlag: "high",
      agentFlag: undefined,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutLines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({ id: SESSION_ID, title: "renamed", riskLevel: "high" });
  });

  it("memory create --json emits full MemoryEntry", async () => {
    vi.stubEnv("MEGA_TEST_MEMORY_ENTRY_ID", MEMORY_ID);
    vi.stubEnv("MEGA_TEST_NOW", TS);
    vi.stubEnv("NODE_ENV", "test");
    try {
      const code = await runMemoryCreate({
        ...commonInput(),
        projectName: "demo",
        scopeFlag: "project",
        contentFlag: "first note",
        sessionFlag: undefined,
        json: true,
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdoutLines[0] ?? "{}") as Record<string, unknown>;
      expect(parsed).toMatchObject({
        id: MEMORY_ID,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "first note",
        createdAt: TS,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("connector sync --json emits per-target records", async () => {
    const code = await runConnectorSync({
      ...commonInput(),
      projectName: "demo",
      targetFlag: undefined,
      json: true,
    });
    expect(code).toBe(0);
    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0] ?? "[]") as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(7);
    expect(parsed[0]).toEqual({
      id: "claude-code",
      relativePath: "CLAUDE.md",
      status: "skipped",
      session: null,
    });
  });
});
