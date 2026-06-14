import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOverlaySummary } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOverlayEffectiveSettings } from "../src/read.js";
import { runOverlayOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOverlayOutputPipeline } from "../src/run.js";

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

const WK = "0123456789abcdef";
const LSID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-06-10T12:00:00.000Z";
const NEW_ID = "fixed-id";

describe("runOverlayOutputPipeline — overlay key wiring", () => {
  let store: string;
  let cwd: string;
  let logPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-overlay-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-overlay-cwd-"));
    logPath = join(cwd, "log.txt");
    await writeFile(logPath, "line one\nerror: boom\nline three\n");
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function run(overrides: { storeRawOutput?: boolean } = {}) {
    return runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path: logPath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: overrides.storeRawOutput ?? true,
      permissions: null,
      now: () => NOW,
      newId: () => NEW_ID,
    });
  }

  it("appends one overlay event under stats/<wk>/<lsid>.events.jsonl and a chunk-set under content/<wk>/<lsid>", async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);

    const eventsRaw = await readFile(join(store, "stats", WK, `${LSID}.events.jsonl`), "utf8");
    const lines = eventsRaw.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] as string);
    expect(event.workspaceKey).toBe(WK);
    expect(event.liveSessionId).toBe(LSID);
    expect(event.sourceKind).toBe("file");
    expect(event.chunkSetId).toBe(NEW_ID);

    const chunkSetRaw = await readFile(join(store, "content", WK, LSID, `${NEW_ID}.json`), "utf8");
    const chunkSet = JSON.parse(chunkSetRaw);
    expect(chunkSet.workspaceKey).toBe(WK);
    expect(chunkSet.liveSessionId).toBe(LSID);

    expect(readOverlaySummary({ root: store }, WK, LSID)?.eventsTotal).toBe(1);
  });

  it("storeRawOutput=false appends the event without a chunkSetId", async () => {
    const outcome = await run({ storeRawOutput: false });
    expect(outcome.ok).toBe(true);
    const eventsRaw = await readFile(join(store, "stats", WK, `${LSID}.events.jsonl`), "utf8");
    const event = JSON.parse(eventsRaw.trimEnd());
    expect(event.chunkSetId).toBeUndefined();
  });

  it("chunkSet write failure → store_write_failed (not a throw)", async () => {
    await writeFile(join(store, "content"), "not a directory");
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("store_write_failed");
  });
});

describe("runOverlayOutputExecCommand — overlay key wiring", () => {
  let store: string;
  let cwd: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-overlay-exec-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-overlay-exec-cwd-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("appends an overlay command event under stats/<wk>/<lsid>.events.jsonl", async () => {
    const child = makeChild();
    const promise = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      command: "pnpm",
      args: ["test"],
      intent: "find failing tests",
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
    const outcome = await promise;
    expect(outcome.ok).toBe(true);

    const eventsRaw = await readFile(join(store, "stats", WK, `${LSID}.events.jsonl`), "utf8");
    const event = JSON.parse(eventsRaw.trimEnd());
    expect(event.workspaceKey).toBe(WK);
    expect(event.liveSessionId).toBe(LSID);
    expect(event.sourceKind).toBe("command");
  });
});

describe("resolveOverlayEffectiveSettings — no registry", () => {
  it("returns settings straight from caller-resolved cwd + permissions, no session lookup", () => {
    const result = resolveOverlayEffectiveSettings({
      cwd: "/tmp/demo",
      permissions: null,
      mode: "balanced",
      maxReturnedBytes: 9_000,
      storeRawOutput: false,
    });
    expect(result.cwd).toBe("/tmp/demo");
    expect(result.mode).toBe("balanced");
    expect(result.storeRawOutput).toBe(false);
    expect(result.permissions).toBeNull();
  });
});
