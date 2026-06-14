import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-a";
const WK = encodeWorkspaceKey(CWD);
const DIR = "ws-dir";
const ID = "wssess01";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

const base = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/memory`;

describe("live memory routes", () => {
  it("POST session-scoped note → 201 with liveSessionId === id, persisted under memory/<wk>.jsonl", async () => {
    server = await start();
    const res = await fetch(base(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "session", content: "a session note", type: "decision" }),
    });
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.scope).toBe("session");
    expect(row.liveSessionId).toBe(ID);
    expect(row.workspaceKey).toBe(WK);
  });

  it("POST project-scoped note → 201 with liveSessionId === null", async () => {
    server = await start();
    const res = await fetch(base(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", content: "a workspace note" }),
    });
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.scope).toBe("project");
    expect(row.liveSessionId).toBeNull();
  });

  it("GET ?scope=session returns only this session's rows; ?scope=project the workspace rows", async () => {
    server = await start();
    await fetch(base(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "session", content: "sess note" }),
    });
    await fetch(base(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", content: "proj note" }),
    });
    const sessRes = await fetch(`${base()}?scope=session`);
    const sess = await sessRes.json();
    expect(sess).toHaveLength(1);
    expect(sess[0].scope).toBe("session");

    const projRes = await fetch(`${base()}?scope=project`);
    const proj = await projRes.json();
    expect(proj).toHaveLength(1);
    expect(proj[0].scope).toBe("project");

    const allRes = await fetch(base());
    expect(await allRes.json()).toHaveLength(2);
  });

  it("PATCH updates content; DELETE removes the row", async () => {
    server = await start();
    const created = await (
      await fetch(base(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "session", content: "before" }),
      })
    ).json();

    const patched = await fetch(`${base()}/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "after" }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).content).toBe("after");

    const del = await fetch(`${base()}/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await del.json()).id).toBe(created.id);

    const after = await (await fetch(base())).json();
    expect(after).toHaveLength(0);
  });

  it("traversal dir → 400 validation_failed", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/..%2F..%2Fetc/${ID}/memory`);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("unknown (dir,id) → 404 claude_session_not_found", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/unknownid/memory`);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("claude_session_not_found");
  });
});
