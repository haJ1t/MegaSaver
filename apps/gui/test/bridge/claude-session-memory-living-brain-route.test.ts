import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-brain";
const DIR = "ws-dir";
const ID = "wssess_brain01";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-brain-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-brain-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

const base = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/memory`;

describe("Living Brain extended memory routes", () => {
  it("GET memory/:entryId/history returns lineage chain", async () => {
    server = await start();
    const created = await (
      await fetch(base(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", content: "Original decision", type: "decision" }),
      })
    ).json();

    const historyRes = await fetch(`${base()}/${created.id}/history`);
    expect(historyRes.status).toBe(200);
    const historyData = await historyRes.json();
    expect(historyData.entryId).toBe(created.id);
    expect(Array.isArray(historyData.chain)).toBe(true);
    expect(historyData.chain).toHaveLength(1);
    expect(historyData.chain[0].id).toBe(created.id);
  });

  it("POST memory/:entryId/reopen resets validTo to null", async () => {
    server = await start();
    const created = await (
      await fetch(base(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", content: "Superseded decision", type: "decision" }),
      })
    ).json();

    // Mark validTo (simulate closed decision)
    await fetch(`${base()}/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ validTo: new Date().toISOString() }),
    });

    const reopenRes = await fetch(`${base()}/${created.id}/reopen`, {
      method: "POST",
    });
    expect(reopenRes.status).toBe(200);
    const reopenedData = await reopenRes.json();
    expect(reopenedData.validTo).toBeNull();
  });

  it("GET memory/:entryId/explain returns scoring and ranking metrics", async () => {
    server = await start();
    const created = await (
      await fetch(base(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", content: "Explained decision", type: "decision" }),
      })
    ).json();

    const explainRes = await fetch(`${base()}/${created.id}/explain`);
    expect(explainRes.status).toBe(200);
    const explainData = await explainRes.json();
    expect(explainData.entryId).toBe(created.id);
    expect(explainData.confidence).toBe("medium");
    expect(typeof explainData.effectiveConfidence).toBe("number");
  });

  it("GET /api/brain/sync/status returns brain sync status", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/brain/sync/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("configured");
    expect(data).toHaveProperty("status");
  });
});
