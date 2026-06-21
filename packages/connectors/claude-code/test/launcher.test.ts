import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { LaunchInput } from "@megasaver/connectors-shared";
import { describe, expect, it, vi } from "vitest";
import { type SpawnFn, type SpawnedChild, createClaudeCodeLauncher } from "../src/launcher.js";

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

function input(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    workdir: "/repo",
    instruction: "go",
    model: "sonnet",
    permissionMode: "plan",
    allowedTools: [],
    sessionId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

describe("createClaudeCodeLauncher", () => {
  it("spawns claude with built args and cwd=workdir", () => {
    const child = makeFakeChild();
    const spawn: SpawnFn = vi.fn(() => child as unknown as SpawnedChild);
    createClaudeCodeLauncher({ spawn }).launch(input());
    expect(spawn).toHaveBeenCalledOnce();
    const call = (spawn as unknown as { mock: { calls: [string, string[], { cwd: string }][] } })
      .mock.calls[0];
    expect(call[0]).toBe("claude");
    expect(call[2]).toEqual({ cwd: "/repo" });
    expect(call[1]).toContain("--session-id");
  });

  it("emits one stream event per JSON line, skips non-JSON, reassembles split lines", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({
      spawn: () => child as unknown as SpawnedChild,
    }).launch(input());
    const payloads: unknown[] = [];
    handle.onEvent((e) => {
      if (e.kind === "stream") payloads.push(e.payload);
    });
    child.stdout.emit("data", '{"a":1}\n');
    child.stdout.emit("data", "not json\n");
    child.stdout.emit("data", '{"b":');
    child.stdout.emit("data", "2}\n");
    expect(payloads).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("emits stderr events", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({
      spawn: () => child as unknown as SpawnedChild,
    }).launch(input());
    const errs: string[] = [];
    handle.onEvent((e) => {
      if (e.kind === "stderr") errs.push(e.text);
    });
    child.stderr.emit("data", "boom");
    expect(errs).toEqual(["boom"]);
  });

  it("flushes a trailing line and reports the exit code on close", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({
      spawn: () => child as unknown as SpawnedChild,
    }).launch(input());
    const payloads: unknown[] = [];
    let exit: { code: number | null } | undefined;
    handle.onEvent((e) => {
      if (e.kind === "stream") payloads.push(e.payload);
    });
    handle.onExit((r) => {
      exit = r;
    });
    child.stdout.emit("data", '{"final":true}'); // no trailing newline
    child.emit("close", 0);
    expect(payloads).toEqual([{ final: true }]);
    expect(exit).toEqual({ code: 0 });
  });

  it("surfaces a spawn error as a stderr event + exit code null", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({
      spawn: () => child as unknown as SpawnedChild,
    }).launch(input());
    const errs: string[] = [];
    let exit: { code: number | null } | undefined;
    handle.onEvent((e) => {
      if (e.kind === "stderr") errs.push(e.text);
    });
    handle.onExit((r) => {
      exit = r;
    });
    child.emit("error", new Error("spawn claude ENOENT"));
    expect(errs).toEqual(["spawn claude ENOENT"]);
    expect(exit).toEqual({ code: null });
  });

  it("cancel() sends SIGTERM", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({
      spawn: () => child as unknown as SpawnedChild,
    }).launch(input());
    handle.cancel();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("handle.sessionId reflects the resume id", () => {
    const child = makeFakeChild();
    const handle = createClaudeCodeLauncher({
      spawn: () => child as unknown as SpawnedChild,
    }).launch(input({ sessionId: undefined, resumeSessionId: "resume-xyz" }));
    expect(handle.sessionId).toBe("resume-xyz");
  });

  it("kind is claude-code", () => {
    expect(createClaudeCodeLauncher().kind).toBe("claude-code");
  });
});
