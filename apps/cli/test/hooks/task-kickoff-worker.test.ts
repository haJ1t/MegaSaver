import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  captureIntent: vi.fn(),
  close: vi.fn(),
  intentWorkspaceKeyForPayload: vi.fn(),
  postMessage: vi.fn(),
  prepareTaskKickoff: vi.fn(),
  prepareTaskKickoffIntentCapture: vi.fn(),
  workerData: {} as unknown,
}));

vi.mock("node:worker_threads", () => ({
  isMainThread: true,
  parentPort: {
    close: state.close,
    off: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    postMessage: state.postMessage,
  },
  get workerData() {
    return state.workerData;
  },
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
  prepareTaskKickoffIntentCapture: state.prepareTaskKickoffIntentCapture,
}));

const { runTaskKickoffWorker } = await import("../../src/hooks/task-kickoff-worker.js");

afterEach(() => {
  state.captureIntent.mockReset();
  state.close.mockReset();
  state.intentWorkspaceKeyForPayload.mockReset();
  state.postMessage.mockReset();
  state.prepareTaskKickoff.mockReset();
  state.prepareTaskKickoffIntentCapture.mockReset();
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
    expect(state.prepareTaskKickoffIntentCapture).not.toHaveBeenCalled();
    expect(state.captureIntent).not.toHaveBeenCalled();
    expect(state.prepareTaskKickoff).not.toHaveBeenCalled();
    expect(state.postMessage).toHaveBeenCalledWith({ kind: "done" });
    expect(state.close).toHaveBeenCalledOnce();
  });
});
