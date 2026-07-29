import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { readOverlayEvents, readOverlaySummary, readSummary } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputExecCommand, runOverlayOutputExecCommand } from "../src/run-command.js";
import { runOutputPipeline, runOverlayOutputPipeline } from "../src/run.js";

// The last two ledger sites that could not express a loss.
//
// The proxy_read_file paths (run.ts) appended `returnedBytes`/`bytesSaved`/
// `savingRatio` straight from the filter result: no signed `deltaBytes`, and
// no count of the MCP envelope the result is actually delivered in
// (mcp-bridge/src/server.ts `JSON.stringify(payload)`). A read that the filter
// passes through untouched still costs the model the whole envelope — scores,
// the 9-field `features` object, warnings, metrics — so it is a NET LOSS that
// the ledger recorded as a flat zero, and `deltaBytesOf` then folded the
// clamped `bytesSaved`, keeping the aggregate at zero too.
//
// The exec paths already carry the signed field; what is pinned for them here
// is the other half of the B1 migration shape: `savingRatio` STAYS clamped
// (the stats event schema is `z.number().min(0).max(1)`, so a signed ratio
// would be rejected at the write boundary), and the signed ratio is derived
// from `deltaBytes / rawBytes` instead.

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WK = "0123456789abcdef";
const LSID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-06-10T12:00:00.000Z";
const NEW_ID = "cs-signed-delta";
const ROOT_PID = String(process.pid);

// Small enough that the filter has nothing to drop: the delivered envelope is
// strictly bigger than the source, which is the only shape that proves a
// clamped ledger wrong.
const TINY = "line one\nerror: boom\nline three\n";

// The ordinary case, where the filter really does drop most of the input. The
// clamped fields are indistinguishable from the pre-envelope ones on TINY (both
// are zero there), so only a genuinely compressing read can pin them.
function bulk(): string {
  return Array.from(
    { length: 1200 },
    (_, i) => `ERROR handler-${i} failed at /repo/src/mod-${i}/run-${i}.ts:${i}:1 batch ${i * 3}`,
  ).join("\n");
}

type LedgerEvent = {
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  deltaBytes?: number;
  savingRatio: number;
};

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
  return ((_c: string, _a: readonly string[], _o: Record<string, unknown>) =>
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

async function readProjectEvents(store: string): Promise<LedgerEvent[]> {
  const raw = await readFile(
    join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
    "utf8",
  );
  return raw
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as LedgerEvent);
}

// The event must describe the payload the caller was handed, not a private
// pre-envelope view of it.
function expectSignedLoss(event: LedgerEvent, payload: unknown): void {
  const envelopeBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  expect(
    event.returnedBytes,
    "the ledger must count the MCP envelope the result is delivered in, not the excerpt text alone",
  ).toBe(envelopeBytes);
  expect(
    event.deltaBytes,
    "without the signed field deltaBytesOf falls back to the clamped bytesSaved and the loss disappears",
  ).toBe(event.rawBytes - event.returnedBytes);
  expect(
    event.deltaBytes,
    "this payload inflates: a ledger that cannot go below zero is claiming a saving that did not happen",
  ).toBeLessThan(0);
  expect(event.bytesSaved, "the legacy clamped field keeps its meaning").toBe(0);
  expect(event.savingRatio, "the schema bounds savingRatio to [0,1]; it stays the clamp").toBe(0);
}

// A compressing read: the clamped fields must be derived from the SAME
// envelope-aware numerator as the signed one. On an inflating read they are all
// zero, so this is the only fixture that can tell the honest clamp apart from
// the pre-envelope value it replaced.
function expectClampedFieldsFollowTheEnvelope(event: LedgerEvent, payload: unknown): void {
  const envelopeBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  expect(event.returnedBytes).toBe(envelopeBytes);
  expect(
    event.bytesSaved,
    "a bytesSaved computed from the excerpt text alone over-reports the saving on every read",
  ).toBe(event.rawBytes - event.returnedBytes);
  expect(event.bytesSaved).toBeGreaterThan(0);
  expect(
    event.savingRatio,
    "the ratio must be the same saving over the same raw total, not the filter's pre-envelope ratio",
  ).toBe(event.bytesSaved / event.rawBytes);
  expect(
    event.deltaBytes,
    "above zero the clamp is a no-op: the signed field and the legacy one must agree",
  ).toBe(event.bytesSaved);
}

describe("proxy_read_file ledger records an inflating read as a loss", () => {
  let store: string;
  let projectRoot: string;
  let logPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-signed-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-signed-root-"));
    logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, TINY);
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("runOutputPipeline persists a negative deltaBytes and a negative session total", async () => {
    const outcome = await runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: logPath,
      intent: "find the error",
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const events = await readProjectEvents(store);
    expect(events).toHaveLength(1);
    expectSignedLoss(events[0] as LedgerEvent, outcome.result);

    const summary = readSummary({ root: store }, PROJECT_ID, SESSION_ID);
    expect(
      summary?.deltaBytesTotal,
      "the aggregate is where the honesty claim is read from; a zero here is the bug B1 exists to end",
    ).toBe(events[0]?.deltaBytes);
    expect(summary?.deltaBytesTotal).toBeLessThan(0);
    expect(summary?.bytesSavedTotal, "the legacy total is unchanged by this migration").toBe(0);
  });

  it("runOverlayOutputPipeline persists a negative deltaBytes and a negative overlay total", async () => {
    const outcome = await runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: projectRoot,
      path: logPath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => NEW_ID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const events = readOverlayEvents({ root: store }, WK, LSID) as unknown as LedgerEvent[];
    expect(events).toHaveLength(1);
    expectSignedLoss(events[0] as LedgerEvent, outcome.result);

    const summary = readOverlaySummary({ root: store }, WK, LSID);
    expect(summary?.deltaBytesTotal).toBe(events[0]?.deltaBytes);
    expect(summary?.deltaBytesTotal).toBeLessThan(0);
    expect(summary?.bytesSavedTotal).toBe(0);
  });

  it("runOutputPipeline's clamped fields are computed from the envelope too", async () => {
    const bulkPath = join(projectRoot, "bulk.log");
    await writeFile(bulkPath, bulk());
    const outcome = await runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: bulkPath,
      intent: "find the error",
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const events = await readProjectEvents(store);
    expect(events).toHaveLength(1);
    const event = events[0] as LedgerEvent;
    expectClampedFieldsFollowTheEnvelope(event, outcome.result);

    const summary = readSummary({ root: store }, PROJECT_ID, SESSION_ID);
    expect(summary?.bytesSavedTotal).toBe(event.bytesSaved);
    expect(summary?.deltaBytesTotal).toBe(event.deltaBytes);
    // The correction this makes to a normal read: the filter's own view is
    // strictly rosier than what the transport delivers.
    expect(event.bytesSaved).toBeLessThan(outcome.result.bytesSaved);
    expect(event.savingRatio).toBeLessThan(outcome.result.savingRatio);
  });

  it("runOverlayOutputPipeline's clamped fields are computed from the envelope too", async () => {
    const bulkPath = join(projectRoot, "bulk.log");
    await writeFile(bulkPath, bulk());
    const outcome = await runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: projectRoot,
      path: bulkPath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => NEW_ID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const events = readOverlayEvents({ root: store }, WK, LSID) as unknown as LedgerEvent[];
    expect(events).toHaveLength(1);
    const event = events[0] as LedgerEvent;
    expectClampedFieldsFollowTheEnvelope(event, outcome.result);

    const summary = readOverlaySummary({ root: store }, WK, LSID);
    expect(summary?.bytesSavedTotal).toBe(event.bytesSaved);
    expect(summary?.deltaBytesTotal).toBe(event.deltaBytes);
  });
});

describe("exec ledger keeps savingRatio clamped and derives the signed ratio", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-signed-exec-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-signed-exec-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  // rawBytes is the honest denominator for both ratios; the numerator is the
  // only thing the clamp touches, so the signed ratio must reconstruct from
  // deltaBytes without a second stored field.
  function expectDerivableSignedRatio(event: LedgerEvent): void {
    expect(event.savingRatio).toBe(0);
    const signedRatio = (event.deltaBytes as number) / event.rawBytes;
    expect(
      signedRatio,
      "an inflating exec must be readable as a negative ratio from the fields on the event",
    ).toBeLessThan(0);
    expect(signedRatio).toBe((event.rawBytes - event.returnedBytes) / event.rawBytes);
  }

  it("runOutputExecCommand", async () => {
    const child = makeChild();
    const pending = runOutputExecCommand({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "grep",
      args: ["error"],
      intent: "find the error",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(TINY));
    child.emit("close", 0);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    const events = await readProjectEvents(store);
    expect(events).toHaveLength(1);
    const event = events[0] as LedgerEvent;
    expect(event.deltaBytes).toBeLessThan(0);
    expectDerivableSignedRatio(event);
  });

  it("runOverlayOutputExecCommand", async () => {
    const child = makeChild();
    const pending = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: projectRoot,
      command: "grep",
      args: ["error"],
      intent: "find the error",
      originPid: ROOT_PID,
      mode: "balanced",
      storeRawOutput: true,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => NEW_ID,
      spawn: spawnMock(child),
    } as unknown as Parameters<typeof runOverlayOutputExecCommand>[0]);
    child.stdout.emit("data", Buffer.from(TINY));
    child.emit("close", 0);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    const events = readOverlayEvents({ root: store }, WK, LSID) as unknown as LedgerEvent[];
    expect(events).toHaveLength(1);
    const event = events[0] as LedgerEvent;
    expect(event.deltaBytes).toBeLessThan(0);
    expectDerivableSignedRatio(event);
  });
});
