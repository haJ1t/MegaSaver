import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOverlayEvents } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOverlayOutputExecCommand } from "../src/run-command.js";

// Track B's B1 made inflation REPRESENTABLE: stats carries a signed
// `deltaBytes`, never clamped. But representable is not visible — every
// compression producer omitted the field, and `deltaBytesOf` then falls back to
// the CLAMPED `bytesSaved`, so an inflating event still aggregates as 0.
//
// The producers are this package's files, so the wiring is Track A's. Without
// it, B1's capability is inert on every path except B3's expansion debt, and
// A4's ratio work would again be measured against a number that cannot go
// negative.
//
// SHIPS RED.

const WK = "0123456789abcdef";
const LSID = "66666666-6666-4666-8666-666666666666";
const ROOT_PID = String(process.pid);

function bulk(): string {
  return Array.from(
    { length: 1200 },
    (_, i) => `ERROR handler-${i} failed at /repo/src/mod-${i}/run-${i}.ts:${i}:1 batch ${i * 3}`,
  ).join("\n");
}

let store: string;
let cwd: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-delta-store-"));
  cwd = await mkdtemp(join(tmpdir(), "cg-delta-cwd-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("signed savings reach the ledger", () => {
  it("the hook path records deltaBytes on a compression event", async () => {
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw: bulk(),
      sourceKind: "command",
      label: "pnpm test",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      newId: () => "cs-delta-hook",
    });
    expect(result.decision).toBe("compressed");

    const events = readOverlayEvents({ root: store }, WK, LSID);
    expect(events).toHaveLength(1);
    const event = events[0] as { deltaBytes?: number; rawBytes: number; returnedBytes: number };
    expect(
      event.deltaBytes,
      "without this the ledger falls back to the clamped bytesSaved and inflation stays invisible",
    ).toBe(event.rawBytes - event.returnedBytes);
  });

  it("the overlay exec path records deltaBytes on a compression event", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = vi.fn(() => true);

    const pending = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      command: "cat",
      args: ["out.log"],
      intent: "why did it fail",
      originPid: ROOT_PID,
      mode: "balanced",
      storeRawOutput: true,
      maxReturnedBytes: undefined,
      permissions: undefined,
      timeoutMs: 5000,
      maxBytes: 1_000_000,
      spawn: ((): unknown => child) as unknown as RunCommandSpawn,
      now: () => "2026-07-28T00:00:00.000Z",
      newId: () => "cs-delta-exec",
    } as unknown as Parameters<typeof runOverlayOutputExecCommand>[0]);

    child.stdout.emit("data", Buffer.from(bulk()));
    child.emit("close", 0);
    expect((await pending).ok).toBe(true);

    const events = readOverlayEvents({ root: store }, WK, LSID);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events as { deltaBytes?: number; rawBytes: number; returnedBytes: number }[]) {
      expect(e.deltaBytes).toBe(e.rawBytes - e.returnedBytes);
    }
  });
});
