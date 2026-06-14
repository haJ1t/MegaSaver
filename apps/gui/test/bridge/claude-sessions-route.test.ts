import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const DIR = "-Users-me-proj";

function userLine(text: string, ts: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    cwd: "/Users/me/proj",
    message: { role: "user", content: text },
  });
}

describe("claude-sessions routes", () => {
  let server: TestServer;
  let ccRoot: string;
  let metaRoot: string;

  function writeMeta(id: string, title: string): void {
    const dir = join(metaRoot, "ws", "win");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `local_${id}.json`),
      JSON.stringify({ cliSessionId: id, title, cwd: "/Users/me/proj", lastActivityAt: 1 }),
    );
  }

  beforeEach(async () => {
    ccRoot = mkdtempSync(join(tmpdir(), "cc-route-"));
    metaRoot = mkdtempSync(join(tmpdir(), "cc-route-meta-"));
    mkdirSync(join(ccRoot, DIR), { recursive: true });
    const a = join(ccRoot, DIR, "aaaa.jsonl");
    const b = join(ccRoot, DIR, "bbbb.jsonl");
    writeFileSync(a, `${userLine("older", "2026-06-14T10:00:00.000Z")}\n`);
    writeFileSync(b, `${userLine("newer", "2026-06-14T11:00:00.000Z")}\n`);
    utimesSync(a, new Date("2026-06-14T10:00:00Z"), new Date("2026-06-14T10:00:00Z"));
    utimesSync(b, new Date("2026-06-14T11:00:00Z"), new Date("2026-06-14T11:00:00Z"));
    writeMeta("aaaa", "Older session");
    writeMeta("bbbb", "Newer session");
    server = await startTestBridge({ claudeProjectsDir: ccRoot, claudeSessionsMetaDir: metaRoot });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(ccRoot, { recursive: true, force: true });
    rmSync(metaRoot, { recursive: true, force: true });
  });

  it("GET /api/claude-sessions lists most-recent first", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string }[];
    expect(body.map((s) => s.id)).toEqual(["bbbb", "aaaa"]);
  });

  it("GET /api/claude-sessions?limit=1 paginates", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions?limit=1`);
    const body = (await res.json()) as { id: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe("bbbb");
  });

  it("GET /api/claude-sessions/:dir/:id returns a transcript", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/bbbb`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { role: string }[]; projectLabel: string };
    expect(body.messages[0]?.role).toBe("user");
    expect(body.projectLabel).toBe("/Users/me/proj");
  });

  it("GET unknown session → 404 claude_session_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/zzzz`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("claude_session_not_found");
  });

  it("GET with path traversal → 400 validation_failed", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/${DIR}/${encodeURIComponent("../../x")}`,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("validation_failed");
  });

  it("GET with dir-segment traversal → 400 validation_failed", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/${encodeURIComponent("../../etc")}/passwd`,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("validation_failed");
  });

  it("POST /api/claude-sessions → 405 method_not_allowed", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(((await res.json()) as { code: string }).code).toBe("method_not_allowed");
  });

  it("GET /:dir/:id/stream opens an SSE stream with a snapshot event", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/bbbb/stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const { value } = await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: snapshot");
    await (reader as ReadableStreamDefaultReader<Uint8Array>).cancel();
  });
});
