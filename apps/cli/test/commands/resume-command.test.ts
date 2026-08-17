import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runResume } from "../../src/commands/resume/index.js";
import { resumeCapsulePath } from "../../src/hooks/resume-capsule.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = Date.parse("2026-08-06T10:00:00.000Z");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_ID = "55555555-5555-4555-8555-555555555555";
const tmpdir = () => realpathSync(readTemporaryDirectory());

let storeRoot: string;
let projectRoot: string;

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-resume-cmd-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-resume-cmd-proj-"));
  writeFileSync(join(projectRoot, "app.ts"), "console.log('hello');\n");
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo-app",
    rootPath: projectRoot,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  } as never);
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "Feature X",
    startedAt: new Date(NOW - 3_600_000).toISOString(),
    endedAt: null,
  } as never);
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runResume command", () => {
  it("prints capsule to stdout on valid session id and returns 0", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const code = await runResume({
      sessionId: SESSION_ID,
      last: false,
      copy: false,
      next: false,
      json: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      now: () => NOW,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
    });

    expect(code).toBe(0);
    expect(stdoutLines.join("\n")).toContain("# Session resurrection — demo-app");
    expect(stderrLines).toHaveLength(0);
  });

  it("returns 1 when session is not found", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const code = await runResume({
      sessionId: "00000000-0000-0000-0000-000000000000",
      last: false,
      copy: false,
      next: false,
      json: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      now: () => NOW,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
    });

    expect(code).toBe(1);
    expect(stderrLines.join("\n")).toContain("not found");
  });

  it("refuses resurrection when session is live according to mesh presence", async () => {
    const wk = encodeWorkspaceKey(projectRoot);
    mkdirSync(join(storeRoot, "stats", wk), { recursive: true });
    writeFileSync(
      join(storeRoot, "stats", wk, `${LIVE_ID}.json`),
      JSON.stringify({
        liveSessionId: LIVE_ID,
        eventsTotal: 1,
        rawBytesTotal: 100,
        returnedBytesTotal: 50,
        bytesSavedTotal: 50,
        savingRatio: 0.5,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 1,
        updatedAt: new Date(NOW - 60_000).toISOString(),
      }),
    );
    mkdirSync(join(storeRoot, "mesh", "presence"), { recursive: true });
    writeFileSync(
      join(storeRoot, "mesh", "presence", `${LIVE_ID}.json`),
      JSON.stringify({
        liveSessionId: LIVE_ID,
        status: "idle",
        lastSeenAt: new Date(NOW - 60_000).toISOString(),
      }),
    );

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const code = await runResume({
      sessionId: LIVE_ID,
      last: false,
      copy: false,
      next: false,
      json: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      now: () => NOW,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
    });

    expect(code).toBe(1);
    expect(stderrLines.join("\n")).toContain("resurrection refused");
  });

  it("queues a capsule for next session on POSIX with --next", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const code = await runResume({
      sessionId: SESSION_ID,
      last: false,
      copy: false,
      next: true,
      json: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      now: () => NOW,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
    });

    expect(code).toBe(0);
    expect(stdoutLines.join("\n")).toContain(
      'queued resurrection capsule for the next session in "demo-app"',
    );
    const wk = encodeWorkspaceKey(projectRoot);
    expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(true);
  });

  it("refuses --next on win32", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const code = await runResume({
      sessionId: SESSION_ID,
      last: false,
      copy: false,
      next: true,
      json: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "win32",
      localAppData: undefined,
      now: () => NOW,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
    });

    expect(code).toBe(1);
    expect(stderrLines.join("\n")).toContain("requires POSIX");
    const wk = encodeWorkspaceKey(projectRoot);
    expect(existsSync(resumeCapsulePath(storeRoot, wk))).toBe(false);
  });

  it("outputs structured json with --json", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const code = await runResume({
      sessionId: SESSION_ID,
      last: false,
      copy: false,
      next: false,
      json: true,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      now: () => NOW,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutLines.join("\n")) as {
      sessionId: string;
      layout: string;
      tokenCount: number;
    };
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.layout).toBe("registry");
    expect(parsed.tokenCount).toBeGreaterThan(0);
  });

  it("copies to clipboard with --copy", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const copyText = vi.fn();
    const code = await runResume({
      sessionId: SESSION_ID,
      last: false,
      copy: true,
      next: false,
      json: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      now: () => NOW,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
      copyText,
    });

    expect(code).toBe(0);
    expect(copyText).toHaveBeenCalledOnce();
    expect(copyText.mock.calls[0]?.[0]).toContain("# Session resurrection");
  });
});
