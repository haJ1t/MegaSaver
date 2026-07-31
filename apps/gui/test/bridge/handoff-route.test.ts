import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-handoff";
const DIR = "ws-dir";
const ID = "wssess_handoff01";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-handoff-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-handoff-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

describe("Hot Handoff & Warmup bridge routes", () => {
  it("POST /api/handoff/pack returns handoff packet response", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/handoff/pack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceKey: encodeWorkspaceKey(CWD),
        targetAgent: "cursor",
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("targetAgent", "cursor");
    expect(data).toHaveProperty("packed");
  });

  it("DELETE /api/handoff/clear clears active handoff block", async () => {
    server = await start();
    const res = await fetch(
      `${server.baseUrl}/api/handoff/clear?workspaceKey=${encodeWorkspaceKey(CWD)}&targetAgent=cursor`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cleared).toBe(true);
  });

  it("GET /api/claude-sessions/:dir/:id/warmup returns warmup brief", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/warmup`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("brief");
    expect(data).toHaveProperty("workspaceKey");
  });
});
