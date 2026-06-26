import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOverlaySummary } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashContent as hc } from "../src/read-index.js";
import { resolveOverlayEffectiveSettings } from "../src/read.js";
import { runOverlayOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOverlayOutputPipeline } from "../src/run.js";
import { loadShownIndex } from "../src/shown-index.js";

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

describe("runOverlayOutputPipeline — diff-on-reread suppression (overlay)", () => {
  let store: string;
  let cwd: string;
  let filePath: string;
  let idCounter: number;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-overlay-reread-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-overlay-reread-cwd-"));
    filePath = join(cwd, "f.txt");
    await writeFile(filePath, "line one\nerror: boom\nline three\n");
    idCounter = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function run(opts: { storeRawOutput?: boolean } = {}) {
    return runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path: filePath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: opts.storeRawOutput ?? true,
      permissions: null,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
    });
  }

  function sessionContentDir() {
    return join(store, "content", WK, LSID);
  }

  it("T6: first read persists + records; no unchanged field", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect("unchanged" in r1.result).toBe(false);
    const names = await readdir(sessionContentDir());
    expect(names).toContain("read-index.json");
    expect(
      names.filter(
        (n) => n.endsWith(".json") && n !== "read-index.json" && n !== "shown-index.json",
      ),
    ).toHaveLength(1);
  });

  it("T7: second unchanged read suppresses + skips persist", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const firstChunkSetId = r1.result.chunkSetId;
    const r2 = await run();
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.excerpts).toEqual([]);
    expect(r2.result.unchanged?.priorChunkSetId).toBe(firstChunkSetId);
    expect(r2.result.summary).toContain("unchanged");
    const names = await readdir(sessionContentDir());
    expect(
      names.filter(
        (n) => n.endsWith(".json") && n !== "read-index.json" && n !== "shown-index.json",
      ),
    ).toHaveLength(1);
  });

  it("T8/T10: changed content is a miss with no unchanged field", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    await writeFile(filePath, "changed bytes\n");
    const r2 = await run();
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("unchanged" in r2.result).toBe(false);
    const names = await readdir(sessionContentDir());
    expect(
      names.filter(
        (n) => n.endsWith(".json") && n !== "read-index.json" && n !== "shown-index.json",
      ),
    ).toHaveLength(2);
  });

  it("T12: storeRawOutput=false writes no index; next read is a miss", async () => {
    await run({ storeRawOutput: false });
    await expect(readdir(sessionContentDir())).rejects.toMatchObject({ code: "ENOENT" });
    const r2 = await run({ storeRawOutput: false });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("unchanged" in r2.result).toBe(false);
  });
});

describe("runOverlayOutputPipeline — already-in-context dedup (overlay)", () => {
  let store: string;
  let cwd: string;
  let fileA: string;
  let fileB: string;
  let idCounter: number;
  const BODY = "line one\nerror: boom\nline three\n";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-ov-dedup-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-ov-dedup-cwd-"));
    fileA = join(cwd, "a.txt");
    fileB = join(cwd, "b.txt");
    await writeFile(fileA, BODY);
    await writeFile(fileB, BODY);
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function run(path: string, opts: { storeRawOutput?: boolean } = {}) {
    return runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: opts.storeRawOutput ?? true,
      permissions: null,
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
    });
  }
  function sessionContentDir() {
    return join(store, "content", WK, LSID);
  }

  it("suppresses identical content under overlay keys + evidence preserved", async () => {
    const r1 = await run(fileA);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // biome-ignore lint/style/noNonNullAssertion: storeRawOutput=true persists a chunkSetId
    const firstChunkSetId = r1.result.chunkSetId!;
    const r2 = await run(fileB);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.deduped?.priorChunkSetIds).toContain(firstChunkSetId);
    expect(r2.result.summary).toContain("already shown earlier this session");
    const idx = loadShownIndex(sessionContentDir());
    // biome-ignore lint/style/noNonNullAssertion: first read returned >=1 excerpt
    expect(idx[hc(r1.result.excerpts[0]!.text)]).toEqual({ chunkSetId: firstChunkSetId });
    const firstRaw = await readFile(join(sessionContentDir(), `${firstChunkSetId}.json`), "utf8");
    expect(firstRaw).toContain("error: boom");
  });

  it("no prior hit -> nothing suppressed", async () => {
    await writeFile(fileA, "unique alpha\n");
    await writeFile(fileB, "unique beta\n");
    await run(fileA);
    const r2 = await run(fileB);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("deduped" in r2.result).toBe(false);
  });
});
