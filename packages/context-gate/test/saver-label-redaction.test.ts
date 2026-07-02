import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputExecCommand, runOverlayOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputPipeline, runOverlayOutputPipeline } from "../src/run.js";

// The source label / command / args / file path are secret-bearing. Like the
// chunk CONTENT, they must be redacted before they reach the persisted chunk-set
// source and the stats event — across BOTH the legacy (projectId/sessionId) and
// overlay (workspaceKey/liveSessionId) saver paths, for command and file sources.

const SECRET_BODY = "0123456789abcdefghijABCDEFGHIJ0123456789";
const SECRET_TOKEN = `ghp_${SECRET_BODY}`;

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WK = "0123456789abcdef";
const LSID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-06-10T12:00:00.000Z";
const NEW_ID = "fixed-id";
const ROOT_PID = String(process.pid);

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function spawnMock(child: FakeChild): RunCommandSpawn {
  return ((_command: string, _args: readonly string[], _options: Record<string, unknown>) =>
    child) as unknown as RunCommandSpawn;
}

function registry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (failure) => failure,
    listSessionFailures: () => [],
    listMemoryEntries: () => [],
    listProjectRules: () => [],
  };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOneEvent(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw.trimEnd().split("\n")[0] as string);
}

let store: string;
let work: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-label-store-"));
  work = await mkdtemp(join(tmpdir(), "cg-label-work-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe("saver source-label redaction — command paths", () => {
  it("overlay command: secret in args is redacted in persisted source.args + event label", async () => {
    const child = makeChild();
    const promise = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: work,
      command: "pnpm",
      args: ["exec", SECRET_TOKEN],
      intent: "x",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      spawn: spawnMock(child),
      now: () => NOW,
      newId: () => NEW_ID,
    });
    child.stdout.emit("data", Buffer.from("ok\nerror: boom\n"));
    child.emit("close", 0);
    expect((await promise).ok).toBe(true);

    const chunk = await readJson(join(store, "content", WK, LSID, `${NEW_ID}.json`));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const source = chunk["source"] as { command: string; args: string[] };
    expect(JSON.stringify(source.args)).not.toContain(SECRET_BODY);
    expect(source.command).toBe("pnpm");
    expect(JSON.stringify(source.args)).toContain("[REDACTED]");

    const event = await readOneEvent(join(store, "stats", WK, `${LSID}.events.jsonl`));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).not.toContain(SECRET_BODY);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).toContain("[REDACTED]");
  });

  it("legacy command: secret in args is redacted in persisted source.args + event label", async () => {
    const child = makeChild();
    const promise = runOutputExecCommand({
      registry: registry(work),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "pnpm",
      args: ["exec", SECRET_TOKEN],
      intent: "x",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      spawn: spawnMock(child),
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
    });
    child.stdout.emit("data", Buffer.from("ok\nerror: boom\n"));
    child.emit("close", 0);
    expect((await promise).ok).toBe(true);

    const chunk = await readJson(join(store, "content", PROJECT_ID, SESSION_ID, `${NEW_ID}.json`));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const source = chunk["source"] as { command: string; args: string[] };
    expect(JSON.stringify(source.args)).not.toContain(SECRET_BODY);
    expect(source.command).toBe("pnpm");
    expect(JSON.stringify(source.args)).toContain("[REDACTED]");

    const event = await readOneEvent(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
    );
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).not.toContain(SECRET_BODY);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).toContain("[REDACTED]");
  });
});

describe("saver source-label redaction — file paths", () => {
  it("overlay file: secret in path is redacted in persisted source.path + event label", async () => {
    const secretPath = join(work, `${SECRET_TOKEN}.log`);
    await writeFile(secretPath, "line one\nerror: boom\nline three\n");
    const outcome = await runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: work,
      path: secretPath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => NEW_ID,
    });
    expect(outcome.ok).toBe(true);

    const chunk = await readJson(join(store, "content", WK, LSID, `${NEW_ID}.json`));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const source = chunk["source"] as { path: string };
    expect(source.path).not.toContain(SECRET_BODY);
    expect(source.path).toContain("[REDACTED]");

    const event = await readOneEvent(join(store, "stats", WK, `${LSID}.events.jsonl`));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).not.toContain(SECRET_BODY);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).toContain("[REDACTED]");
  });

  it("legacy file: secret in path is redacted in persisted source.path + event label", async () => {
    const secretPath = join(work, `${SECRET_TOKEN}.log`);
    await writeFile(secretPath, "line one\nerror: boom\nline three\n");
    const outcome = await runOutputPipeline({
      registry: registry(work),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: secretPath,
      intent: "find the error",
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);

    const chunk = await readJson(join(store, "content", PROJECT_ID, SESSION_ID, `${NEW_ID}.json`));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const source = chunk["source"] as { path: string };
    expect(source.path).not.toContain(SECRET_BODY);
    expect(source.path).toContain("[REDACTED]");

    const event = await readOneEvent(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
    );
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).not.toContain(SECRET_BODY);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(event["label"] as string).toContain("[REDACTED]");
  });
});
