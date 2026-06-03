import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOutputFile } from "../../src/commands/output/file.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-10T00:00:00.000Z";
const NOW = "2026-05-10T12:00:00.000Z";
const NEW_ID = "cs-fixed-id";

type SeedOpts = { storeRawOutput?: boolean; withTokenSaver?: boolean };

async function seed(store: string, projectRoot: string, opts: SeedOpts = {}): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
    ]),
  );
  const session: Record<string, unknown> = {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo session",
    startedAt: TS,
    endedAt: null,
  };
  if (opts.withTokenSaver !== false) {
    session.tokenSaver = {
      enabled: true,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: opts.storeRawOutput ?? true,
      redactSecrets: true,
      autoRepair: true,
      createdAt: TS,
      updatedAt: TS,
    };
  }
  await writeFile(join(store, "sessions.json"), JSON.stringify([session]));
}

function capture(): { out: string[]; err: string[] } {
  return { out: [], err: [] };
}

describe("runOutputFile", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-outfile-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-outfile-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("happy path: filters an in-sandbox file, stores chunk-set, exit 0 with result + chunkSetId", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\nline two\nerror: boom\nline four\n");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "find the error",
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] ?? "") as {
      sessionId: string;
      result: { chunkSetId?: string; rawBytes: number };
    };
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.result.chunkSetId).toBe(NEW_ID);

    const persisted = await readdir(join(store, "content", PROJECT_ID, SESSION_ID));
    expect(persisted).toContain(`${NEW_ID}.json`);
  });

  it("storeRawOutput=false: exit 0, no chunkSetId, no file written", async () => {
    await seed(store, projectRoot, { storeRawOutput: false });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "hello world\n");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "summary",
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out[0] ?? "") as { result: { chunkSetId?: string } };
    expect(parsed.result.chunkSetId).toBeUndefined();
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("pre-AA session (tokenSaver undefined): defaults applied, exit 0", async () => {
    await seed(store, projectRoot, { withTokenSaver: false });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "alpha\nbeta\n");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "summary",
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: true,
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(0);
    // default storeRawOutput is true → chunk-set is persisted
    const parsed = JSON.parse(out[0] ?? "") as { result: { chunkSetId?: string } };
    expect(parsed.result.chunkSetId).toBe(NEW_ID);
  });

  it("missing --intent → intent_required, exit 1, no read (no chunk-set written)", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "data\n");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: undefined,
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("intent_required"))).toBe(true);
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("empty --intent is treated as missing → intent_required, exit 1", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "data\n");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "",
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("intent_required"))).toBe(true);
  });

  it("gate A policy denial (.env path) → path_denied:secret_path_read, exit 1, no read", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const envPath = join(projectRoot, ".env");
    await writeFile(envPath, "SECRET=topsecret\n");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "anything",
      path: envPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("path_denied"))).toBe(true);
    expect(err.some((e) => e.includes("secret_path_read"))).toBe(true);
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("malformed permissions.yaml → policy_load_failed, exit 1, no read (fail-closed, I3)", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\n");
    await mkdir(join(projectRoot, ".megasaver"), { recursive: true });
    await writeFile(join(projectRoot, ".megasaver", "permissions.yaml"), "deny:\n  read: [oops");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "anything",
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("policy_load_failed"))).toBe(true);
    // The file was never read ⇒ no chunk-set persisted.
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("gate B sandbox escape (../) → path_unsafe, exit 1, no read", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "anything",
      path: "../../../../../../etc/hosts",
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("path_unsafe"))).toBe(true);
  });

  it("nonexistent in-sandbox path → file_read_failed, exit 1", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: SESSION_ID,
      intentFlag: "anything",
      path: join(projectRoot, "nope.txt"),
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => e.includes("file_read_failed"))).toBe(true);
  });

  it("nonexistent session → session_not_found, exit 1", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "data\n");

    const { out, err } = capture();
    const code = await runOutputFile({
      sessionId: "99999999-9999-4999-8999-999999999999",
      intentFlag: "anything",
      path: logPath,
      storeFlag: store,
      cwd: projectRoot,
      home: projectRoot,
      xdgDataHome: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.some((e) => /not found/.test(e))).toBe(true);
  });
});
