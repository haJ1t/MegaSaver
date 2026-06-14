import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-tasks-ws";
const WK = encodeWorkspaceKey(CWD);
const DIR = "ws-dir";
const ID = "wssess01";

const STEP_A = "00000000-0000-4000-8000-000000000a01";
const STEP_B = "00000000-0000-4000-8000-000000000a02";

function plan(id: string, createdAt: string) {
  return {
    id,
    workspaceKey: WK,
    liveSessionId: ID,
    task: "do work",
    status: "planned",
    steps: [
      {
        id: STEP_A,
        type: "scan",
        title: "scan",
        dependsOn: [],
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
      {
        id: STEP_B,
        type: "edit",
        title: "edit",
        dependsOn: [STEP_A],
        status: "pending",
        startedAt: null,
        completedAt: null,
      },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-tasks-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-tasks-meta-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

const url = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/tasks`;

describe("live tasks route", () => {
  it("returns seeded plans sorted desc with ready = ready steps", async () => {
    server = await startTestBridge({
      claudeProjectsDir: projectsDir,
      claudeSessionsMetaDir: metaDir,
      store: {
        overlayTasks: [
          {
            workspaceKey: WK,
            liveSessionId: ID,
            lines: [
              plan("00000000-0000-4000-8000-000000000b01", "2026-06-14T00:00:00.000Z"),
              plan("00000000-0000-4000-8000-000000000b02", "2026-06-14T01:00:00.000Z"),
            ],
          },
        ],
      },
    });
    const res = await fetch(url());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].plan.id).toBe("00000000-0000-4000-8000-000000000b02");
    // STEP_A has no deps -> ready; STEP_B depends on A -> not ready.
    expect(body[0].ready).toEqual([STEP_A]);
  });

  it("returns [] when no plans are seeded", async () => {
    server = await startTestBridge({
      claudeProjectsDir: projectsDir,
      claudeSessionsMetaDir: metaDir,
    });
    const res = await fetch(url());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("traversal dir → 400 validation_failed", async () => {
    server = await startTestBridge({
      claudeProjectsDir: projectsDir,
      claudeSessionsMetaDir: metaDir,
    });
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/..%2F..%2Fetc/${ID}/tasks`);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("unknown session → 404 claude_session_not_found", async () => {
    server = await startTestBridge({
      claudeProjectsDir: projectsDir,
      claudeSessionsMetaDir: metaDir,
    });
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/unknownid/tasks`);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("claude_session_not_found");
  });
});
