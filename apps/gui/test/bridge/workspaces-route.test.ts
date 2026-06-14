import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const DIR = "-Users-me-proj";

function userLine(text: string, ts: string, cwd: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    cwd,
    message: { role: "user", content: text },
  });
}

type WorkspaceBody = { key: string; label: string; sessionCount: number; lastActivityMs: number };

describe("workspaces route", () => {
  let server: TestServer;
  let ccRoot: string;
  let metaRoot: string;

  function writeMeta(id: string, title: string, cwd: string): void {
    const dir = join(metaRoot, "ws", "win");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `local_${id}.json`),
      JSON.stringify({ cliSessionId: id, title, cwd, lastActivityAt: 1 }),
    );
  }

  beforeEach(async () => {
    ccRoot = mkdtempSync(join(tmpdir(), "cc-ws-"));
    metaRoot = mkdtempSync(join(tmpdir(), "cc-ws-meta-"));
    mkdirSync(join(ccRoot, DIR), { recursive: true });
    // Two sessions share cwd /Users/me/proj; one is in /Users/me/other.
    const a = join(ccRoot, DIR, "aaaa.jsonl");
    const b = join(ccRoot, DIR, "bbbb.jsonl");
    const c = join(ccRoot, DIR, "cccc.jsonl");
    writeFileSync(a, `${userLine("a", "2026-06-14T10:00:00.000Z", "/Users/me/proj")}\n`);
    writeFileSync(b, `${userLine("b", "2026-06-14T11:00:00.000Z", "/Users/me/proj")}\n`);
    writeFileSync(c, `${userLine("c", "2026-06-14T10:30:00.000Z", "/Users/me/other")}\n`);
    utimesSync(a, new Date("2026-06-14T10:00:00Z"), new Date("2026-06-14T10:00:00Z"));
    utimesSync(b, new Date("2026-06-14T11:00:00Z"), new Date("2026-06-14T11:00:00Z"));
    utimesSync(c, new Date("2026-06-14T10:30:00Z"), new Date("2026-06-14T10:30:00Z"));
    writeMeta("aaaa", "Session A", "/Users/me/proj");
    writeMeta("bbbb", "Session B", "/Users/me/proj");
    writeMeta("cccc", "Session C", "/Users/me/other");
    server = await startTestBridge({ claudeProjectsDir: ccRoot, claudeSessionsMetaDir: metaRoot });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(ccRoot, { recursive: true, force: true });
    rmSync(metaRoot, { recursive: true, force: true });
  });

  it("GET /api/workspaces groups sessions by cwd, recent-first", async () => {
    const res = await fetch(`${server.baseUrl}/api/workspaces`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspaceBody[];
    expect(body.map((w) => w.label)).toEqual(["/Users/me/proj", "/Users/me/other"]);
    const proj = body.find((w) => w.label === "/Users/me/proj");
    expect(proj?.sessionCount).toBe(2);
  });

  it("POST /api/workspaces → 405 method_not_allowed", async () => {
    const res = await fetch(`${server.baseUrl}/api/workspaces`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(((await res.json()) as { code: string }).code).toBe("method_not_allowed");
  });

  it("empty metadata store → []", async () => {
    const missing = join(metaRoot, "does-not-exist");
    const emptyServer = await startTestBridge({
      claudeProjectsDir: ccRoot,
      claudeSessionsMetaDir: missing,
    });
    try {
      const res = await fetch(`${emptyServer.baseUrl}/api/workspaces`);
      expect(res.status).toBe(200);
      expect((await res.json()) as WorkspaceBody[]).toEqual([]);
    } finally {
      await emptyServer.close();
    }
  });
});
