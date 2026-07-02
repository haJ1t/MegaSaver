import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendOverlayFailure, readOverlayFailures } from "../src/overlay-failures.js";
import { runOverlayOutputExecCommand } from "../src/run-command.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOverlayOutputPipeline } from "../src/run.js";

const WK = "0123456789abcdef";
const LSID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-02T12:00:00.000Z";
const ROOT_PID = String(process.pid);

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};
function makeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = vi.fn(() => {
    c.killed = true;
    return true;
  });
  return c;
}
function spawnMock(child: FakeChild): RunCommandSpawn {
  return ((_c: string, _a: readonly string[], _o: Record<string, unknown>) =>
    child) as unknown as RunCommandSpawn;
}

// 40 prose lines (one generic chunk) with no dots, error words, or intent
// keywords, followed by the line that references the failed file — it lands
// in the second chunk, so the two rank independently.
const NOISE_LINES = Array.from(
  { length: 40 },
  (_, i) => `plain release chatter line ${i + 1} about roadmap and planning`,
);
const BOOSTABLE_BODY = `${[
  ...NOISE_LINES,
  "token validation logic lives in src/x.ts near the session refresh",
].join("\n")}\n`;

describe("runOverlayOutputExecCommand — overlay failure capture", () => {
  let store: string;
  let cwd: string;
  let idCounter: number;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-ov-capture-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-ov-capture-cwd-"));
    idCounter = 0;
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function exec(child: FakeChild, intent = "run tests") {
    return runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      command: "pnpm",
      args: ["test"],
      intent,
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      spawn: spawnMock(child),
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
    });
  }

  it("appends an overlay failure record when the command exits non-zero", async () => {
    const child = makeChild();
    const p = exec(child);
    child.stdout.emit("data", Buffer.from("boom"));
    child.emit("close", 1);
    const res = await p;
    expect(res.ok).toBe(true);
    const records = readOverlayFailures(store, WK, LSID);
    expect(records).toHaveLength(1);
    expect(records[0]?.command).toBe("pnpm test");
    expect(records[0]?.errorOutput).toContain("boom");
    expect(records[0]?.source).toBe("proxy-classifier");
    expect(records[0]?.createdAt).toBe(NOW);
  });

  it("redacts secrets before the record hits disk", async () => {
    const child = makeChild();
    const p = exec(child);
    child.stderr.emit(
      "data",
      Buffer.from("auth failed: Bearer abcdefghijklmnopqrstuvwxyz123456\n"),
    );
    child.emit("close", 1);
    await p;
    const records = readOverlayFailures(store, WK, LSID);
    expect(records[0]?.errorOutput).toContain("[REDACTED]");
    expect(records[0]?.errorOutput).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("appends nothing on exit 1 with EMPTY output (benign no-match convention)", async () => {
    const child = makeChild();
    const p = exec(child);
    child.emit("close", 1);
    const res = await p;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.childExitCode).toBe(1);
    expect(readOverlayFailures(store, WK, LSID)).toHaveLength(0);
  });

  it("appends a record on exit 3 with EMPTY output (benign filter is exit-1-only)", async () => {
    const child = makeChild();
    const p = exec(child);
    child.emit("close", 3);
    const res = await p;
    expect(res.ok).toBe(true);
    const records = readOverlayFailures(store, WK, LSID);
    expect(records).toHaveLength(1);
    expect(records[0]?.errorOutput).toBe("");
  });

  it("appends nothing when the command exits zero", async () => {
    const child = makeChild();
    const p = exec(child);
    child.stdout.emit("data", Buffer.from("ok"));
    child.emit("close", 0);
    await p;
    expect(readOverlayFailures(store, WK, LSID)).toHaveLength(0);
  });

  it("a failed capture write surfaces a non-fatal warning, never breaks delivery", async () => {
    await writeFile(join(store, "failures"), "not a directory");
    const child = makeChild();
    const p = exec(child);
    child.stdout.emit("data", Buffer.from("boom"));
    child.emit("close", 1);
    const res = await p;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.warnings?.some((w) => w.startsWith("session-failure capture skipped"))).toBe(
      true,
    );
  });

  it("a prior overlay failure signature boosts the chunk that references it above noise", async () => {
    const failing = makeChild();
    const p1 = exec(failing);
    failing.stdout.emit(
      "data",
      Buffer.from("error TS2322: Type 'string' is not assignable at src/x.ts:42\n"),
    );
    failing.emit("close", 1);
    await p1;

    const next = makeChild();
    const p2 = exec(next, "auth token validation");
    next.stdout.emit("data", Buffer.from(BOOSTABLE_BODY));
    next.emit("close", 0);
    const res = await p2;
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const top = res.result.excerpts[0];
    expect(top?.text).toContain("src/x.ts");
    expect(top?.engine).toBeDefined();
    expect(top?.engine?.failureHistoryBoost).toBeGreaterThan(0);
  });
});

describe("runOverlayOutputPipeline — failure-aware ranking (overlay reads)", () => {
  let store: string;
  let cwd: string;
  let notesPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-ov-read-hints-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-ov-read-hints-cwd-"));
    notesPath = join(cwd, "notes.log");
    await writeFile(notesPath, BOOSTABLE_BODY);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function run() {
    return runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path: notesPath,
      intent: "auth token validation",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => "cs-hints",
    });
  }

  it("a stored overlay failure signature boosts the chunk that references it above noise", async () => {
    appendOverlayFailure(store, WK, LSID, {
      command: "pnpm tsc",
      errorOutput: "error TS2322: Type 'string' is not assignable at src/x.ts:42",
      source: "proxy-classifier",
      createdAt: NOW,
    });
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const top = outcome.result.excerpts[0];
    expect(top?.text).toContain("src/x.ts");
    expect(top?.engine).toBeDefined();
    expect(top?.engine?.failureHistoryBoost).toBeGreaterThan(0);
  });

  it("no stored failures → engine ranking still on, boost stays zero", async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const top = outcome.result.excerpts[0];
    expect(top?.engine).toBeDefined();
    expect(top?.engine?.failureHistoryBoost).toBe(0);
  });
});
