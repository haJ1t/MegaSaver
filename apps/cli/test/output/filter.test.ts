import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOutputFilter } from "../../src/commands/output/filter.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";
const NOW = "2026-05-10T12:00:00.000Z";
const NEW_ID = "cs-fixed-id";

async function seed(store: string, projectRoot: string): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "demo session",
        startedAt: TS,
        endedAt: null,
        tokenSaver: {
          enabled: true,
          mode: "balanced",
          maxReturnedBytes: 12_000,
          storeRawOutput: true,
          redactSecrets: true,
          autoRepair: true,
          createdAt: TS,
          updatedAt: TS,
        },
      },
    ]),
  );
}

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

describe("runOutputFilter", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-outfilter-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-outfilter-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("happy path: --file log in sandbox → exit 0, result shape", async () => {
    await seed(store, projectRoot);
    const logPath = join(projectRoot, "test-output.log");
    await writeFile(logPath, "PASS a\nFAIL b\nerror: boom\nPASS c\n");

    const { out, err } = capture();
    const code = await runOutputFilter({
      sessionId: SESSION_ID,
      intentFlag: "find failures",
      fileFlag: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] ?? "") as { sessionId: string; result: { rawBytes: number } };
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(typeof parsed.result.rawBytes).toBe("number");
  });

  it("text mode surfaces the secret-redaction warning on stderr", async () => {
    await seed(store, projectRoot);
    const secretPath = join(projectRoot, "config.log");
    await writeFile(secretPath, "token ghp_1234567890123456789012345678901234AB here\n");

    const { out, err } = capture();
    const code = await runOutputFilter({
      sessionId: SESSION_ID,
      intentFlag: "find token",
      fileFlag: secretPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(0);
    expect(err.some((l) => /redacted \d+ secret/.test(l))).toBe(true);
  });

  it("missing --file → file_required, exit 1", async () => {
    await seed(store, projectRoot);

    const { out, err } = capture();
    const code = await runOutputFilter({
      sessionId: SESSION_ID,
      intentFlag: "find failures",
      fileFlag: undefined,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("file_required"))).toBe(true);
  });

  it("missing --intent → intent_required, exit 1", async () => {
    await seed(store, projectRoot);
    const logPath = join(projectRoot, "test-output.log");
    await writeFile(logPath, "data\n");

    const { out, err } = capture();
    const code = await runOutputFilter({
      sessionId: SESSION_ID,
      intentFlag: undefined,
      fileFlag: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("intent_required"))).toBe(true);
  });

  it("gate A policy denial via --file (.env) → path_denied, exit 1", async () => {
    await seed(store, projectRoot);
    const envPath = join(projectRoot, ".env");
    await writeFile(envPath, "SECRET=x\n");

    const { out, err } = capture();
    const code = await runOutputFilter({
      sessionId: SESSION_ID,
      intentFlag: "anything",
      fileFlag: envPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("path_denied"))).toBe(true);
  });

  it("gate B sandbox escape via --file → path_unsafe, exit 1", async () => {
    await seed(store, projectRoot);

    const { out, err } = capture();
    const code = await runOutputFilter({
      sessionId: SESSION_ID,
      intentFlag: "anything",
      fileFlag: "../../../../../../etc/hosts",
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("path_unsafe"))).toBe(true);
  });

  it("stats write failure → error: store_write_failed, exit 1", async () => {
    await seed(store, projectRoot);
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "hello\n");
    await writeFile(join(store, "stats"), "not a directory");

    const { out, err } = capture();
    const code = await runOutputFilter({
      sessionId: SESSION_ID,
      intentFlag: "summary",
      fileFlag: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("error: store_write_failed:");
  });
});
