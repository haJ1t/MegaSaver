import { Worker } from "node:worker_threads";
import { workspaceKeySchema } from "@megasaver/shared";
import type { TaskKickoffEvent } from "@megasaver/stats";
import { z } from "zod";
import { TASK_KICKOFF_CANCELLATION_GRACE_MS } from "./task-kickoff.js";

export const TASK_KICKOFF_DEADLINE_MS = 500;

export type TaskKickoffWorkerData = {
  payload: unknown;
  storeRoot: string;
  deadlineAtMs: number;
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
  deadlineAtMs?: number;
  stdout?: TaskKickoffStdout;
  createWorker?: (workerData: TaskKickoffWorkerData) => TaskKickoffProcessWorker;
  recordEvent?: (storeRoot: string, event: TaskKickoffEvent, deadlineAtMs: number) => void;
};

export type RunTaskKickoffProcessResult = { wrote: boolean };

const workerMessageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      envelope: z.string().min(1),
      event: z
        .object({
          id: z.string().uuid(),
          workspaceKey: workspaceKeySchema,
          sessionId: z.string().min(1),
          createdAt: z.string().datetime({ offset: true }),
          tokenCount: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z.object({ kind: z.literal("done") }).strict(),
  z.object({ kind: z.literal("intentDone") }).strict(),
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

function resolveDeadlineAtMs(requested: number | undefined): number | undefined {
  const deadlineAtMs = requested ?? Date.now() + TASK_KICKOFF_DEADLINE_MS;
  if (!Number.isFinite(deadlineAtMs) || deadlineAtMs <= Date.now()) return undefined;
  return deadlineAtMs;
}

export function runTaskKickoffProcess(
  input: RunTaskKickoffProcessInput,
): Promise<RunTaskKickoffProcessResult> {
  process.exitCode = 0;
  const deadlineAtMs = resolveDeadlineAtMs(input.deadlineAtMs);
  if (deadlineAtMs === undefined) return Promise.resolve({ wrote: false });

  return new Promise((resolve) => {
    const stdout = input.stdout ?? process.stdout;
    let state: "preparing" | "writing" | "accounting" | "terminal" = "preparing";
    let worker: TaskKickoffProcessWorker | undefined;
    let workerAvailable = true;
    let deliverySettled = false;
    let readyEvent: TaskKickoffEvent | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
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
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
      if (cancellationTimer !== undefined) clearTimeout(cancellationTimer);
      cancellationTimer = undefined;
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
      if (Date.now() >= deadlineAtMs) {
        failDelivery();
        return;
      }

      state = "accounting";
      settleDelivery(true);
      const immediate = setImmediate(() => {
        void (async () => {
          if (Date.now() >= deadlineAtMs) {
            finishLifecycle(true);
            return;
          }
          try {
            if (readyEvent !== undefined) {
              if (input.recordEvent !== undefined) {
                input.recordEvent(input.storeRoot, readyEvent, deadlineAtMs);
              } else {
                const { appendTaskKickoffEvent } = await import("@megasaver/stats");
                if (Date.now() >= deadlineAtMs) {
                  finishLifecycle(true);
                  return;
                }
                appendTaskKickoffEvent({ root: input.storeRoot, deadlineAtMs }, readyEvent);
              }
            }
          } catch {
            // Delivery already succeeded; accounting is advisory.
          }
          if (Date.now() >= deadlineAtMs) {
            finishLifecycle(true);
            return;
          }
          if (!workerAvailable || worker === undefined) return;
          try {
            worker.postMessage({ kind: "record" });
          } catch {
            finishLifecycle(true);
          }
        })();
      });
      immediate.unref();
      if (!workerAvailable || worker === undefined) finishLifecycle(false);
    };

    const onWorkerMessage = (message: unknown): void => {
      if (state === "terminal") return;
      if (Date.now() >= deadlineAtMs) {
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
        readyEvent = parsed.data.event;
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
        workerUnavailableWhileWriting(true);
        return;
      }

      if (parsed.data.kind === "intentDone") finishLifecycle(false);
      else finishLifecycle(true);
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

    const beginWorkerCancellation = (): void => {
      if (state !== "preparing" || worker === undefined) return;
      try {
        worker.postMessage({ kind: "abort" });
      } catch {
        // The hard deadline still owns terminal cleanup.
      }
    };

    const onDeadline = (): void => {
      if (state === "terminal") return;
      const remainingMs = deadlineAtMs - Date.now();
      if (remainingMs > 0) {
        deadlineTimer = setTimeout(onDeadline, remainingMs);
        return;
      }
      beginWorkerCancellation();
      const preserveStdoutError = state === "writing" && stdoutErrorInstalled;
      if (state === "preparing" || state === "writing") settleDelivery(false);
      finishLifecycle(true, preserveStdoutError);
    };

    const cancellationDelay = Math.max(
      0,
      deadlineAtMs - Date.now() - TASK_KICKOFF_CANCELLATION_GRACE_MS,
    );
    cancellationTimer = setTimeout(beginWorkerCancellation, cancellationDelay);
    deadlineTimer = setTimeout(onDeadline, Math.max(0, deadlineAtMs - Date.now()));
    const workerData: TaskKickoffWorkerData = {
      payload: input.payload,
      storeRoot: input.storeRoot,
      deadlineAtMs,
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
    if (Date.now() >= deadlineAtMs) onDeadline();
  });
}
