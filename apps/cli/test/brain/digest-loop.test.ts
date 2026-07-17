import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { MemoryEntry } from "@megasaver/core";
import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { describe, expect, it, vi } from "vitest";
import {
  type DigestAction,
  type DigestActionResult,
  type DigestItem,
  runDigestLoop,
} from "../../src/commands/brain/digest-loop.js";

const TS = "2026-07-01T00:00:00.000Z";
const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function entry(id: string, title: string): MemoryEntry {
  return {
    id: id as MemoryEntryId,
    projectId: "11111111-1111-4111-8111-111111111111" as ProjectId,
    sessionId: "22222222-2222-4222-8222-222222222222" as SessionId,
    scope: "session",
    type: "bug",
    title,
    content: "content",
    keywords: [],
    confidence: "low",
    source: "test_failure",
    approval: "suggested",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  } as MemoryEntry;
}

function item(id: string, title: string): DigestItem {
  return { entry: entry(id, title), sessionLabel: "demo session" };
}

type FakeTty = PassThrough & { setRawMode: ReturnType<typeof vi.fn> };

function fakeInput(): FakeTty {
  const stream = new PassThrough() as FakeTty;
  stream.setRawMode = vi.fn();
  return stream;
}

function recorder(respond?: (action: DigestAction) => DigestActionResult) {
  const actions: DigestAction[] = [];
  const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
    actions.push(action);
    return respond === undefined ? { lines: [] } : respond(action);
  };
  return { actions, onAction };
}

describe("runDigestLoop", () => {
  it("sequences y/n/s into approve/reject/skip and quits on exhaustion", async () => {
    const input = fakeInput();
    const out: string[] = [];
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: (line) => out.push(line),
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second"), item(ID_C, "third")],
      onAction,
    });
    input.write("yns");
    await loop;
    expect(actions).toEqual([
      { kind: "approve", id: ID_A },
      { kind: "reject", id: ID_B },
      { kind: "skip", id: ID_C },
      { kind: "quit" },
    ]);
    expect(out.some((line) => line.includes("first"))).toBe(true);
  });

  it("q quits without draining the queue", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("q");
    await loop;
    expect(actions).toEqual([{ kind: "quit" }]);
  });

  it("unknown key prints the key help and stays on the item", async () => {
    const input = fakeInput();
    const out: string[] = [];
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: (line) => out.push(line),
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("xq");
    await loop;
    expect(actions).toEqual([{ kind: "quit" }]);
    expect(out.some((line) => line.startsWith("keys:"))).toBe(true);
  });

  it("u rewinds exactly one decision (single-level undo)", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder((action) =>
      action.kind === "approve" ? { lines: [], decided: true } : { lines: [] },
    );
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("yuss");
    await loop;
    expect(actions).toEqual([
      { kind: "approve", id: ID_A },
      { kind: "undo" },
      { kind: "skip", id: ID_A },
      { kind: "skip", id: ID_B },
      { kind: "quit" },
    ]);
  });

  it("u with nothing to undo emits no undo action", async () => {
    const input = fakeInput();
    const out: string[] = [];
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: (line) => out.push(line),
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("us");
    await loop;
    expect(actions).toEqual([{ kind: "skip", id: ID_A }, { kind: "quit" }]);
    expect(out).toContain("nothing to undo");
  });

  it("a splices spot-review items ahead of the remaining queue", async () => {
    const input = fakeInput();
    const auto = item(ID_C, "auto row");
    const { actions, onAction } = recorder((action) =>
      action.kind === "expandAuto"
        ? { lines: ["reviewing 1 auto-approved"], insertItems: [auto] }
        : { lines: [] },
    );
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("ans");
    await loop;
    expect(actions).toEqual([
      { kind: "expandAuto" },
      { kind: "reject", id: ID_C },
      { kind: "skip", id: ID_A },
      { kind: "quit" },
    ]);
  });

  it("EOF resolves the loop without emitting quit (pipes never hang)", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.end();
    await loop;
    expect(actions).toEqual([]);
  });

  it("never enables raw mode when isTTY is false", async () => {
    const input = fakeInput();
    const { onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("q");
    await loop;
    expect(input.setRawMode).not.toHaveBeenCalled();
  });

  it("TTY: raw mode on for the loop, cooked restored, listeners removed", async () => {
    const input = fakeInput();
    const { onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("q");
    await loop;
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
  });

  it("SIGINT restores cooked mode, removes listeners, resolves without quit", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const before = process.listeners("SIGINT").length;
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const handlers = process.listeners("SIGINT");
    expect(handlers.length).toBe(before + 1);
    (handlers.at(-1) as () => void)();
    await loop;
    expect(process.listeners("SIGINT").length).toBe(before);
    expect(input.setRawMode.mock.calls.at(-1)).toEqual([false]);
    expect(input.listenerCount("data")).toBe(0);
    expect(actions).toEqual([]);
  });

  it("raw-mode Ctrl-C byte (\\u0003) aborts like a signal", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("\u0003");
    await loop;
    expect(actions).toEqual([]);
    expect(input.setRawMode.mock.calls.at(-1)).toEqual([false]);
  });

  it("e pauses raw mode and detaches the loop while the editor owns the TTY", async () => {
    const input = fakeInput();
    const rawDuringEdit: unknown[] = [];
    const dataListenersDuringEdit: number[] = [];
    const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
      if (action.kind === "edit") {
        rawDuringEdit.push(input.setRawMode.mock.calls.at(-1)?.[0]);
        dataListenersDuringEdit.push(input.listenerCount("data"));
        return { lines: ["$EDITOR is not set — skipped"] };
      }
      return { lines: [] };
    };
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    input.write("e");
    await loop;
    expect(rawDuringEdit).toEqual([false]);
    expect(dataListenersDuringEdit).toEqual([0]);
    expect(input.setRawMode.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  // The four tests below are not in the task contract's 12. Each pins a
  // teardown invariant or control that the contract's tests leave green under
  // mutation (delete the guard, suite still passes).

  it("an exception mid-loop restores cooked mode, removes listeners, and propagates", async () => {
    const input = fakeInput();
    const before = process.listeners("SIGINT").length;
    const onAction = async (): Promise<DigestActionResult> => {
      throw new Error("boom");
    };
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    const rejected = expect(loop).rejects.toThrow("boom");
    input.write("y");
    await rejected;
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(process.listeners("SIGINT").length).toBe(before);
  });

  it("SIGTERM restores cooked mode exactly once and removes listeners", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder();
    const before = process.listeners("SIGTERM").length;
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first")],
      onAction,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const handlers = process.listeners("SIGTERM");
    expect(handlers.length).toBe(before + 1);
    (handlers.at(-1) as () => void)();
    await loop;
    expect(process.listeners("SIGTERM").length).toBe(before);
    // Exact call list: the signal path AND the finally both invoke cleanup, so
    // this fails if the idempotency guard stops suppressing the second teardown.
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(actions).toEqual([]);
  });

  it("a second u without an intervening decision prints nothing to undo", async () => {
    const input = fakeInput();
    const out: string[] = [];
    const { actions, onAction } = recorder((action) =>
      action.kind === "approve" ? { lines: [], decided: true } : { lines: [] },
    );
    const loop = runDigestLoop({
      input,
      output: (line) => out.push(line),
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("yuuq");
    await loop;
    expect(actions).toEqual([{ kind: "approve", id: ID_A }, { kind: "undo" }, { kind: "quit" }]);
    expect(out).toContain("nothing to undo");
  });

  // Regressing either half of the edit pause/resume pair drops the keystroke
  // and hangs the loop rather than failing an assertion.
  it("keeps keys typed while the editor owns the TTY and resumes after it returns", async () => {
    const input = fakeInput();
    const actions: DigestAction[] = [];
    const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
      actions.push(action);
      if (action.kind === "edit") {
        input.write("s");
        // A real turn for the stream to try to emit: unpaused, the byte would
        // be emitted to no listener and lost for good.
        await new Promise((resolve) => setImmediate(resolve));
      }
      return { lines: [] };
    };
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("e");
    await loop;
    expect(actions).toEqual([
      { kind: "edit", id: ID_A },
      { kind: "skip", id: ID_B },
      { kind: "quit" },
    ]);
  });

  // The signal lands while the handler owns the turn, so nothing is awaiting a
  // key to hand the abort to — the closed flag is the only carrier.
  it("SIGINT during a slow handler aborts instead of hanging", async () => {
    const input = fakeInput();
    const actions: DigestAction[] = [];
    const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
      actions.push(action);
      if (action.kind === "approve") {
        (process.listeners("SIGINT").at(-1) as () => void)();
        await new Promise((resolve) => setImmediate(resolve));
      }
      return { lines: [] };
    };
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: true,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("y");
    await loop;
    expect(actions).toEqual([{ kind: "approve", id: ID_A }]);
    expect(input.setRawMode.mock.calls.at(-1)).toEqual([false]);
  });

  // EOF's twin of the SIGINT case: the stream ends while the handler owns the
  // turn, so nothing is awaiting a key and `deliver(null)` is dropped. The
  // closed flag set in onEnd is the only carrier; without it this hangs.
  it("EOF during a slow handler aborts instead of hanging", async () => {
    const input = fakeInput();
    const actions: DigestAction[] = [];
    const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
      actions.push(action);
      if (action.kind === "approve") {
        input.end();
        await new Promise((resolve) => setImmediate(resolve));
      }
      return { lines: [] };
    };
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second")],
      onAction,
    });
    input.write("y");
    await loop;
    expect(actions).toEqual([{ kind: "approve", id: ID_A }]);
  });

  // An edit that does NOT decide (edit-abort: $EDITOR unset, or quit without
  // saving) must leave the undo target alone. Only an aborting edit reaches
  // the `decided` guard — an always-deciding fixture cannot tell it from an
  // unconditional assignment.
  it("an aborted edit is not an undo target", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder((action) =>
      action.kind === "approve" ? { lines: [], decided: true } : { lines: [] },
    );
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second"), item(ID_C, "third")],
      onAction,
    });
    input.write("yeusq");
    await loop;
    expect(actions).toEqual([
      { kind: "approve", id: ID_A },
      { kind: "edit", id: ID_B },
      { kind: "undo" },
      // rewound past the aborted edit to the approve, not to the edit
      { kind: "skip", id: ID_A },
      { kind: "quit" },
    ]);
  });

  it("edit is an undo target but skip is not", async () => {
    const input = fakeInput();
    const { actions, onAction } = recorder((action) =>
      action.kind === "edit" ? { lines: [], decided: true } : { lines: [] },
    );
    const loop = runDigestLoop({
      input,
      output: () => {},
      isTTY: false,
      queue: [item(ID_A, "first"), item(ID_B, "second"), item(ID_C, "third")],
      onAction,
    });
    input.write("esusq");
    await loop;
    expect(actions).toEqual([
      { kind: "edit", id: ID_A },
      { kind: "skip", id: ID_B },
      { kind: "undo" },
      // rewound to the edit, not the intervening skip
      { kind: "skip", id: ID_A },
      { kind: "quit" },
    ]);
  });

  // A drained queue MUST emit quit even from a closed pipe: Task 10's handler
  // does real disk I/O, so EOF always lands mid-handler. Anything less than a
  // real await (microtask) passes regardless and would not catch a regression.
  it("emits quit on a drained queue even when the piped input closed mid-handler", async () => {
    const dir = await mkdtemp(join(tmpdir(), "megasaver-digest-"));
    try {
      const input = fakeInput();
      const actions: DigestAction[] = [];
      const onAction = async (action: DigestAction): Promise<DigestActionResult> => {
        actions.push(action);
        if (action.kind === "skip") {
          input.end();
          await writeFile(join(dir, "digest-state.json"), "{}");
        }
        return { lines: [] };
      };
      const loop = runDigestLoop({
        input,
        output: () => {},
        isTTY: false,
        queue: [item(ID_A, "first")],
        onAction,
      });
      input.write("s");
      await loop;
      expect(actions).toEqual([{ kind: "skip", id: ID_A }, { kind: "quit" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
