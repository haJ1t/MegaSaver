import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonDirectoryCoreRegistry, runOutputPipeline } from "../../src/index.js";

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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    session["tokenSaver"] = {
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

describe("runOutputPipeline", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-run-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-run-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("happy path persists a chunk-set and returns chunkSetId", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\nline two\nerror: boom\nline four\n");
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      path: logPath,
      intent: "find the error",
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.chunkSetId).toBe(NEW_ID);
    const persisted = await readdir(join(store, "content", PROJECT_ID, SESSION_ID));
    expect(persisted).toContain(`${NEW_ID}.json`);
  });

  it("storeRawOutput=false returns ok with no chunkSetId and no file", async () => {
    await seed(store, projectRoot, { storeRawOutput: false });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "hello world\n");
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      path: logPath,
      intent: "summary",
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.chunkSetId).toBeUndefined();
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("pre-AA session uses defaults and persists", async () => {
    await seed(store, projectRoot, { withTokenSaver: false });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "alpha\nbeta\n");
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      path: logPath,
      intent: "summary",
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.chunkSetId).toBe(NEW_ID);
  });

  it("session_not_found for an unknown session", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "data\n");
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: "99999999-9999-4999-8999-999999999999" as SessionId,
      path: logPath,
      intent: "anything",
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("session_not_found");
  });

  it("path_denied for a .env path with no read", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const envPath = join(projectRoot, ".env");
    await writeFile(envPath, "SECRET=topsecret\n");
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      path: envPath,
      intent: "anything",
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("path_denied");
      if (outcome.reason === "path_denied") expect(outcome.detail).toBe("secret_path_read");
    }
    await expect(readdir(join(store, "content", PROJECT_ID, SESSION_ID))).rejects.toThrow();
  });

  it("path_unsafe for a ../ sandbox escape", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      path: "../../../../../../etc/hosts",
      intent: "anything",
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("path_unsafe");
  });

  it("file_read_failed for a nonexistent in-sandbox path", async () => {
    await seed(store, projectRoot, { storeRawOutput: true });
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      path: join(projectRoot, "nope.txt"),
      intent: "anything",
      now: () => NOW,
      newId: () => NEW_ID,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("file_read_failed");
  });
});
