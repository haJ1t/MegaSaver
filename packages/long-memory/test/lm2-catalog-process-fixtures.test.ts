import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRecord } from "./lm2-catalog-fixtures.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = { end: vi.fn() };
}

describe("LM2 catalog process fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a CRLF barrier signal and result delivered in one pipe chunk", async () => {
    const child = new FakeChild();
    child.stdin.end.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit("close", 0);
        child.stdout.emit("end");
      });
    });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from('ready\r\n{"result":true}\r\n'));
      });
      return child as never;
    });
    const { startBarrierAppender } = await import("./lm2-catalog-process-fixtures.js");

    const finish = await startBarrierAppender("/fixture", createRecord());

    await expect(finish()).resolves.toBe(true);
  });

  it("waits for stdout to end before parsing a barrier result", async () => {
    const child = new FakeChild();
    child.stdin.end.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit("close", 0);
        child.stdout.emit("data", Buffer.from('{"result":true}\n'));
        child.stdout.emit("end");
      });
    });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.stdout.emit("data", Buffer.from("ready\n")));
      return child as never;
    });
    const { startBarrierAppender } = await import("./lm2-catalog-process-fixtures.js");

    const finish = await startBarrierAppender("/fixture", createRecord());

    await expect(finish()).resolves.toBe(true);
  });

  it("waits for stdout to end before parsing a signaled result", async () => {
    const child = new FakeChild();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("flocking\n"));
        child.emit("close", 0);
        child.stdout.emit("data", Buffer.from('{"result":true}\n'));
        child.stdout.emit("end");
      });
      return child as never;
    });
    const { startSignaledAppender } = await import("./lm2-catalog-process-fixtures.js");

    const finish = await startSignaledAppender(
      "/fixture",
      createRecord(),
      "append-observe-flock",
      "flocking",
    );

    await expect(finish()).resolves.toBe(true);
  });

  it("waits for stdout to end before parsing a direct child result", async () => {
    const child = new FakeChild();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        child.emit("close", 0);
        child.stdout.emit("data", Buffer.from('{"result":true}\n'));
        child.stdout.emit("end");
      });
      return child as never;
    });
    const { runCatalogChild } = await import("./lm2-catalog-process-fixtures.js");

    await expect(runCatalogChild("/fixture", createRecord())).resolves.toBe(true);
  });
});
