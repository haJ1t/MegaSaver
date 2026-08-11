import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSessionsLive } from "../../src/sessions/live.js";

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "cli-sessions-live-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function writeLiveSessions(sessions: unknown[]): void {
  const dir = join(storeRoot, "daemon");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "live-sessions.json"), JSON.stringify(sessions, null, 2));
}

describe("mega sessions live", () => {
  it("renders two sessions sorted and blocked status", async () => {
    const now = Date.parse("2026-08-11T00:02:30.000Z");
    writeLiveSessions([
      { liveSessionId: "a", agent: "claude", cwd: "/a/b", lastSeenAt: "2026-08-11T00:00:00.000Z" },
      {
        liveSessionId: "b",
        agent: "codex",
        cwd: "/a/c",
        lastSeenAt: "2026-08-11T00:01:00.000Z",
        lastHookEvent: "blocked",
      },
    ]);
    const out: string[] = [];
    const code = await runSessionsLive({
      home: tmpdir(),
      storeRoot,
      platform: "linux" as NodeJS.Platform,
      json: true,
      now: () => now,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions[0].liveSessionId).toBe("b");
    expect(
      parsed.sessions.find((s: { liveSessionId: string }) => s.liveSessionId === "b").status,
    ).toBe("blocked");
  });

  it("missing daemon file → empty table", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSessionsLive({
      home: tmpdir(),
      storeRoot,
      platform: "linux" as NodeJS.Platform,
      json: true,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.sessions).toHaveLength(0);
    expect(parsed.warnings).toContain("daemon not running");
  });

  it("human table contains headers", async () => {
    writeLiveSessions([
      { liveSessionId: "a", agent: "claude", cwd: "/x/y/z", lastSeenAt: new Date().toISOString() },
    ]);
    const out: string[] = [];
    await runSessionsLive({
      home: tmpdir(),
      storeRoot,
      platform: "linux" as NodeJS.Platform,
      json: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(out.join("\n")).toContain("live sessions");
  });
});
