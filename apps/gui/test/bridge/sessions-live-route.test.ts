// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

let server: TestServer;

beforeEach(async () => {
  server = await startTestBridge();
});

afterEach(async () => {
  await server.close();
});

describe("GET /api/sessions/live", () => {
  it("returns empty when daemon file missing", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/live`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns live table with sorted sessions", async () => {
    const dir = join(server.storePath, "daemon");
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    writeFileSync(
      join(dir, "live-sessions.json"),
      JSON.stringify(
        [
          {
            liveSessionId: "a",
            agent: "claude",
            cwd: "/a/b",
            lastSeenAt: new Date(now - 90_000).toISOString(),
            lastHookEvent: "blocked",
          },
          {
            liveSessionId: "b",
            agent: "codex",
            cwd: "/a/c",
            lastSeenAt: new Date(now - 10_000).toISOString(),
          },
        ],
        null,
        2,
      ),
    );
    const res = await fetch(`${server.baseUrl}/api/sessions/live`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].liveSessionId).toBe("b");
    expect(
      body.sessions.find((s: { liveSessionId: string; status: string }) => s.liveSessionId === "a")
        .status,
    ).toBe("blocked");
    expect(
      body.sessions.find((s: { liveSessionId: string; status: string }) => s.liveSessionId === "b")
        .status,
    ).toBe("working");
  });

  it("returns 405 for POST", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/live`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
