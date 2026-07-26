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
      queueMicrotask(() => child.emit("close", 0));
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
});
