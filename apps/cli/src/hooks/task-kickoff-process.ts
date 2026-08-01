import { Worker } from "node:worker_threads";
import { taskKickoffEventSchema } from "@megasaver/stats";
import { z } from "zod";

export const TASK_KICKOFF_DEADLINE_MS = 500;

export type TaskKickoffWorkerData = {
  payload: unknown;
  storeRoot: string;
  deadlineMs: number;
};

export type TaskKickoffProcessWorker = {
  onMessage: (listener: (message: unknown) => void) => () => void;
  onError: (listener: (error: Error) => void) => () => void;
  onExit: (listener: (exitCode: number) => void) => () => void;
  postMessage: (message: unknown) => void;
  terminate: () => Promise<number>;
  unref: () => void;
};

type TaskKickoffStdout = {
  write: (chunk: string, callback: (error?: Error | null) => void) => boolean;
  once: (event: "error", listener: (error: Error) => void) => unknown;
  off: (event: "error", listener: (error: Error) => void) => unknown;
};

export type RunTaskKickoffProcessInput = {
  payload: unknown;
  storeRoot: string;
  deadlineMs?: number;
  stdout?: TaskKickoffStdout;
  createWorker?: (workerData: TaskKickoffWorkerData) => TaskKickoffProcessWorker;
};

export type RunTaskKickoffProcessResult = { wrote: boolean };

const workerMessageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      envelope: z.string().min(1),
      event: taskKickoffEventSchema,
    })
    .strict(),
  z.object({ kind: z.literal("done") }).strict(),
  z.object({ kind: z.literal("recorded") }).strict(),
  z.object({ kind: z.literal("recordFailed") }).strict(),
]);

function createNodeWorker(workerData: TaskKickoffWorkerData): TaskKickoffProcessWorker {
  const workerUrl = import.meta.url.endsWith(".mjs")
    ? new URL(import.meta.url)
    : new URL("./task-kickoff-worker.js", import.meta.url);
  const worker = new Worker(workerUrl, {
    workerData,
    stdout: true,
    stderr: true,
  });
  worker.stdout.on("error", () => undefined);
  worker.stderr.on("error", () => undefined);
  worker.stdout.resume();
  worker.stderr.resume();
  return {
    onMessage(listener) {
      worker.on("message", listener);
      return () => worker.off("message", listener);
    },
    onError(listener) {
      worker.on("error", listener);
      return () => worker.off("error", listener);
    },
    onExit(listener) {
      worker.on("exit", listener);
      return () => worker.off("exit", listener);
    },
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      return worker.terminate();
    },
    unref() {
      worker.unref();
    },
  };
}

function boundedDeadlineMs(requested: number | undefined): number {
  const deadlineMs = requested ?? TASK_KICKOFF_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return 0;
  return Math.min(deadlineMs, TASK_KICKOFF_DEADLINE_MS);
}

export function runTaskKickoffProcess(
  input: RunTaskKickoffProcessInput,
): Promise<RunTaskKickoffProcessResult> {
  process.exitCode = 0;
  const deadlineMs = boundedDeadlineMs(input.deadlineMs);
  if (deadlineMs === 0) return Promise.resolve({ wrote: false });

  return new Promise((resolve) => {
    const deadlineAt = performance.now() + deadlineMs;
    const stdout = input.stdout ?? process.stdout;
    let state: "preparing" | "writing" | "accounting" | "terminal" = "preparing";
    let worker: TaskKickoffProcessWorker | undefined;
    let workerAvailable = true;
    let deliverySettled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeMessageListener: (() => void) | undefined;
    let removeErrorListener: (() => void) | undefined;
    let removeExitListener: (() => void) | undefined;
    let stdoutErrorInstalled = false;

    const settleDelivery = (wrote: boolean): void => {
      if (deliverySettled) return;
      deliverySettled = true;
      resolve({ wrote });
    };

    const removeStdoutErrorListener = (): void => {
      if (!stdoutErrorInstalled) return;
      stdoutErrorInstalled = false;
      stdout.off("error", onStdoutError);
    };

    const removeWorkerListeners = (): void => {
      removeMessageListener?.();
      removeErrorListener?.();
      removeExitListener?.();
      removeMessageListener = undefined;
      removeErrorListener = undefined;
      removeExitListener = undefined;
    };

    const releaseWorker = (terminate: boolean): void => {
      if (worker === undefined) return;
      if (terminate) {
        try {
          void worker.terminate().then(removeWorkerListeners, removeWorkerListeners);
        } catch {
          // The hook remains fail-open if termination itself fails.
        }
      }
      try {
        worker.unref();
      } catch {
        // The watchdog already owns the delivery decision.
      }
    };

    const finishLifecycle = (terminate: boolean, preserveStdoutError = false): void => {
      if (state === "terminal") return;
      state = "terminal";
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!preserveStdoutError) removeStdoutErrorListener();
      releaseWorker(terminate);
    };

    const failDelivery = (deferStdoutCleanup = false): void => {
      settleDelivery(false);
      if (deferStdoutCleanup) {
        const immediate = setImmediate(removeStdoutErrorListener);
        immediate.unref();
      }
      finishLifecycle(true, deferStdoutCleanup);
    };

    const workerUnavailableWhileWriting = (terminate: boolean): void => {
      workerAvailable = false;
      releaseWorker(terminate);
    };

    const onStdoutError = (): void => {
      if (state === "terminal") {
        stdoutErrorInstalled = false;
        return;
      }
      if (state !== "writing") return;
      failDelivery();
    };

    const onWriteComplete = (error?: Error | null): void => {
      if (state === "terminal") {
        if (error !== undefined && error !== null) {
          const immediate = setImmediate(removeStdoutErrorListener);
          immediate.unref();
        } else {
          removeStdoutErrorListener();
        }
        return;
      }
      if (state !== "writing") return;
      if (error !== undefined && error !== null) {
        failDelivery(true);
        return;
      }
      removeStdoutErrorListener();
      if (performance.now() >= deadlineAt) {
        failDelivery();
        return;
      }

      if (!workerAvailable || worker === undefined) {
        settleDelivery(true);
        finishLifecycle(false);
        return;
      }

      state = "accounting";
      try {
        worker.postMessage({ kind: "record" });
        settleDelivery(true);
      } catch {
        settleDelivery(true);
        finishLifecycle(true);
      }
    };

    const onWorkerMessage = (message: unknown): void => {
      if (state === "terminal") return;
      if (performance.now() >= deadlineAt) {
        onDeadline();
        return;
      }
      const parsed = workerMessageSchema.safeParse(message);
      if (!parsed.success) {
        if (state === "preparing") failDelivery();
        else if (state === "writing") workerUnavailableWhileWriting(true);
        else finishLifecycle(true);
        return;
      }

      if (state === "preparing") {
        if (parsed.data.kind === "done") {
          settleDelivery(false);
          finishLifecycle(false);
          return;
        }
        if (parsed.data.kind !== "ready") {
          failDelivery();
          return;
        }
        state = "writing";
        stdout.once("error", onStdoutError);
        stdoutErrorInstalled = true;
        try {
          stdout.write(parsed.data.envelope, onWriteComplete);
        } catch {
          failDelivery();
        }
        return;
      }

      if (state === "writing") {
        if (parsed.data.kind !== "ready") workerUnavailableWhileWriting(true);
        return;
      }

      if (parsed.data.kind === "recorded" || parsed.data.kind === "recordFailed") {
        finishLifecycle(false);
      } else {
        finishLifecycle(true);
      }
    };

    const onWorkerError = (): void => {
      if (state === "preparing") failDelivery();
      else if (state === "writing") workerUnavailableWhileWriting(false);
      else if (state === "accounting") finishLifecycle(false);
    };

    const onWorkerExit = (): void => {
      if (state === "preparing") {
        settleDelivery(false);
        finishLifecycle(false);
      } else if (state === "writing") {
        workerUnavailableWhileWriting(false);
      } else if (state === "accounting") {
        finishLifecycle(false);
      }
      removeWorkerListeners();
    };

    const onDeadline = (): void => {
      if (state === "terminal") return;
      const remainingMs = deadlineAt - performance.now();
      if (remainingMs > 0) {
        timer = setTimeout(onDeadline, remainingMs);
        return;
      }
      const preserveStdoutError = state === "writing" && stdoutErrorInstalled;
      if (state === "preparing" || state === "writing") settleDelivery(false);
      finishLifecycle(true, preserveStdoutError);
    };

    timer = setTimeout(onDeadline, deadlineMs);
    const workerData: TaskKickoffWorkerData = {
      payload: input.payload,
      storeRoot: input.storeRoot,
      deadlineMs,
    };
    try {
      worker = (input.createWorker ?? createNodeWorker)(workerData);
      removeMessageListener = worker.onMessage(onWorkerMessage);
      removeErrorListener = worker.onError(onWorkerError);
      removeExitListener = worker.onExit(onWorkerExit);
    } catch {
      failDelivery();
      return;
    }
    if (performance.now() >= deadlineAt) onDeadline();
  });
}
