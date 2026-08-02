import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appendTaskKickoffEvent: vi.fn(),
  captureIntent: vi.fn(),
  close: vi.fn(),
  intentWorkspaceKeyForPayload: vi.fn(),
  once: vi.fn(),
  postMessage: vi.fn(),
  prepareTaskKickoff: vi.fn(),
  prepareTaskKickoffIntentCapture: vi.fn(),
  prepareTaskKickoffStoreRoot: vi.fn(),
  workerData: {} as unknown,
}));

vi.mock("node:worker_threads", () => ({
  isMainThread: true,
  parentPort: {
    close: state.close,
    off: vi.fn(),
    on: vi.fn(),
    once: state.once,
    postMessage: state.postMessage,
  },
  get workerData() {
    return state.workerData;
  },
}));

vi.mock("@megasaver/stats", () => ({
  appendTaskKickoffEvent: state.appendTaskKickoffEvent,
}));

vi.mock("../../src/hooks/intent-run.js", () => ({
  captureIntent: state.captureIntent,
  intentWorkspaceKeyForPayload: state.intentWorkspaceKeyForPayload,
}));

vi.mock("../../src/hooks/task-kickoff.js", () => ({
  TASK_KICKOFF_CANCELLATION_GRACE_MS: 50,
  prepareTaskKickoff: state.prepareTaskKickoff,
}));

vi.mock("../../src/hooks/task-kickoff-store.js", () => ({
  normalizeTaskKickoffStoreRoot: (storeRoot: string) => storeRoot,
  prepareTaskKickoffIntentCapture: state.prepareTaskKickoffIntentCapture,
  prepareTaskKickoffStoreRoot: state.prepareTaskKickoffStoreRoot,
}));

const { runTaskKickoffWorker } = await import("../../src/hooks/task-kickoff-worker.js");

afterEach(() => {
  vi.restoreAllMocks();
  state.appendTaskKickoffEvent.mockReset();
  state.captureIntent.mockReset();
  state.close.mockReset();
  state.intentWorkspaceKeyForPayload.mockReset();
  state.once.mockReset();
  state.postMessage.mockReset();
  state.prepareTaskKickoff.mockReset();
  state.prepareTaskKickoffIntentCapture.mockReset();
  state.prepareTaskKickoffStoreRoot.mockReset();
  state.workerData = {};
});

describe("runTaskKickoffWorker", () => {
  it("does not begin intent capture after the absolute deadline has expired", async () => {
    state.workerData = {
      payload: { prompt: "repair auth", cwd: "/project", session_id: "expired-intent" },
      storeRoot: "/store",
      deadlineAtMs: 1,
    };

    await runTaskKickoffWorker();

    expect(state.intentWorkspaceKeyForPayload).not.toHaveBeenCalled();
    expect(state.prepareTaskKickoffStoreRoot).not.toHaveBeenCalled();
    expect(state.prepareTaskKickoffIntentCapture).not.toHaveBeenCalled();
    expect(state.captureIntent).not.toHaveBeenCalled();
    expect(state.prepareTaskKickoff).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({ kind: "done" });
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("waits for the store-root preflight before beginning intent preflight", async () => {
    let allowRoot: (ready: boolean) => void = () => {};
    state.workerData = {
      payload: { prompt: "repair auth", cwd: "/project", session_id: "root-first" },
      storeRoot: "/store",
      deadlineAtMs: Date.now() + 5_000,
    };
    state.intentWorkspaceKeyForPayload.mockReturnValue("1a2b3c4d5e6f7a8b");
    state.prepareTaskKickoffStoreRoot.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          allowRoot = resolve;
        }),
    );
    state.prepareTaskKickoffIntentCapture.mockResolvedValue(true);
    state.prepareTaskKickoff.mockResolvedValue(null);

    const worker = runTaskKickoffWorker();

    await vi.waitFor(() => {
      expect(state.prepareTaskKickoffStoreRoot).toHaveBeenCalledWith("/store");
    });
    expect(state.prepareTaskKickoffIntentCapture).not.toHaveBeenCalled();

    allowRoot(true);
    await worker;

    expect(state.prepareTaskKickoffIntentCapture).toHaveBeenCalledWith(
      "/store",
      "1a2b3c4d5e6f7a8b",
    );
    expect(state.postMessage).toHaveBeenCalledWith({ kind: "done" });
  });

  it("stops after a late root preflight without starting deadline-expired work", async () => {
    let allowRoot: (ready: boolean) => void = () => {};
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    state.workerData = {
      payload: { prompt: "repair auth", cwd: "/project", session_id: "late-root" },
      storeRoot: "/store",
      deadlineAtMs: 200,
    };
    state.prepareTaskKickoffStoreRoot.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          allowRoot = resolve;
        }),
    );

    const worker = runTaskKickoffWorker();

    await vi.waitFor(() => {
      expect(state.prepareTaskKickoffStoreRoot).toHaveBeenCalledWith("/store");
    });
    now.mockReturnValue(201);
    allowRoot(true);
    await worker;

    expect(state.intentWorkspaceKeyForPayload).not.toHaveBeenCalled();
    expect(state.prepareTaskKickoffIntentCapture).not.toHaveBeenCalled();
    expect(state.captureIntent).not.toHaveBeenCalled();
    expect(state.prepareTaskKickoff).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({ kind: "done" });
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("does not capture intent when its preflight resolves after the deadline", async () => {
    let allowIntent: (ready: boolean) => void = () => {};
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    state.workerData = {
      payload: { prompt: "repair auth", cwd: "/project", session_id: "late-intent" },
      storeRoot: "/store",
      deadlineAtMs: 200,
    };
    state.prepareTaskKickoffStoreRoot.mockResolvedValue(true);
    state.intentWorkspaceKeyForPayload.mockReturnValue("1a2b3c4d5e6f7a8b");
    state.prepareTaskKickoffIntentCapture.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          allowIntent = resolve;
        }),
    );
    state.prepareTaskKickoff.mockResolvedValue(null);

    const worker = runTaskKickoffWorker();

    await vi.waitFor(() => {
      expect(state.prepareTaskKickoffIntentCapture).toHaveBeenCalledOnce();
    });
    now.mockReturnValue(201);
    allowIntent(true);
    await worker;

    expect(state.captureIntent).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({ kind: "done" });
  });

  it("records a delivered event before closing when optional intent capture throws", async () => {
    const event = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceKey: "1a2b3c4d5e6f7a8b",
      sessionId: "capture-failure",
      createdAt: "2026-08-01T10:00:00.000Z",
      tokenCount: 42,
    };
    state.workerData = {
      payload: { prompt: "repair auth", cwd: "/project", session_id: "capture-failure" },
      storeRoot: "/store",
      deadlineAtMs: Date.now() + 5_000,
    };
    state.prepareTaskKickoffStoreRoot.mockResolvedValue(true);
    state.intentWorkspaceKeyForPayload.mockReturnValue(event.workspaceKey);
    state.prepareTaskKickoffIntentCapture.mockResolvedValue(true);
    state.captureIntent.mockImplementation(() => {
      throw new Error("injected intent write failure");
    });
    state.prepareTaskKickoff.mockResolvedValue({ envelope: '{"ok":true}', event });

    await runTaskKickoffWorker();

    const record = state.once.mock.calls.find(([name]) => name === "message")?.[1];
    if (typeof record !== "function") throw new Error("worker did not wait for delivery record");
    record({ kind: "record" });

    await vi.waitFor(() => {
      expect(state.postMessage).toHaveBeenLastCalledWith({ kind: "intentDone" });
    });

    expect(state.appendTaskKickoffEvent).toHaveBeenCalledWith({ root: "/store" }, event);
    expect(state.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { kind: "ready", envelope: '{"ok":true}', event },
      { kind: "recorded" },
      { kind: "intentDone" },
    ]);
    expect(state.close).toHaveBeenCalledOnce();
  });
});
