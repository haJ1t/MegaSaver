import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const DIR = "ws-dir";
const ID = "wssess01";
const CG_START = "CONTEXT_GATE"; // substring present in both CG sentinels

let projectsDir: string;
let metaDir: string;
let cwd: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "wsv-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "wsv-meta-"));
  cwd = mkdtempSync(join(tmpdir(), "wsv-cwd-")); // real, writable workspace dir
  seedWorkspaceCwd({ projectsDir, metaDir, cwd, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

const url = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/token-saver/workspace`;

describe("workspace token-saver activation route", () => {
  it("GET defaults to disabled with no block and reports mcpInstalled=false", async () => {
    server = await start();
    const res = await fetch(url());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.blockPresent).toBe(false);
    expect(body.mcpInstalled).toBe(false);
  });

  it("POST enabled=true writes the CONTEXT_GATE block into <cwd>/CLAUDE.md", async () => {
    server = await start();
    const res = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, mode: "aggressive" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.blockPresent).toBe(true);
    const claudeMd = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain(CG_START);
    expect(claudeMd).toContain("Mode: aggressive");
  });

  it("POST enabled=false removes the block again", async () => {
    server = await start();
    await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, mode: "balanced" }),
    });
    const res = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, mode: "balanced" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).blockPresent).toBe(false);
    const claudeMd = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
    expect(claudeMd).not.toContain(CG_START);
  });

  it("POST with an invalid mode → 400 validation_failed", async () => {
    server = await start();
    const res = await fetch(url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, mode: "turbo" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("traversal dir → 400 validation_failed", async () => {
    server = await start();
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/..%2F..%2Fetc/${ID}/token-saver/workspace`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("unknown session → 404 claude_session_not_found", async () => {
    server = await start();
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/${DIR}/nope/token-saver/workspace`,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("claude_session_not_found");
  });

  it("PUT → 405 method_not_allowed", async () => {
    server = await start();
    const res = await fetch(url(), { method: "PUT" });
    expect(res.status).toBe(405);
  });
});
