import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { appendTaskKickoffEvent } from "@megasaver/stats";
import { z } from "zod";
import { captureIntent } from "./intent-run.js";
import {
  type PreparedTaskKickoff,
  TASK_KICKOFF_CANCELLATION_GRACE_MS,
  prepareTaskKickoff,
} from "./task-kickoff.js";

const taskKickoffWorkerDataSchema = z
  .object({
    payload: z.unknown(),
    storeRoot: z.string().min(1),
    deadlineAtMs: z.number().finite().positive(),
  })
  .strict();
const recordMessageSchema = z.object({ kind: z.literal("record") }).strict();
const abortMessageSchema = z.object({ kind: z.literal("abort") }).strict();

export async function runTaskKickoffWorker(): Promise<void> {
  if (parentPort === null) return;
  const port = parentPort;
  const parsed = taskKickoffWorkerDataSchema.safeParse(workerData);
  if (!parsed.success) {
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }

  if (parsed.data.deadlineAtMs <= Date.now()) {
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  const cancellationTimer = setTimeout(
    cancel,
    Math.max(0, parsed.data.deadlineAtMs - Date.now() - TASK_KICKOFF_CANCELLATION_GRACE_MS),
  );
  const onParentMessage = (message: unknown): void => {
    if (abortMessageSchema.safeParse(message).success) cancel();
  };
  port.on("message", onParentMessage);
  let prepared: PreparedTaskKickoff | null;
  try {
    prepared = await prepareTaskKickoff({
      payload: parsed.data.payload,
      storeRoot: parsed.data.storeRoot,
      deadlineAtMs: parsed.data.deadlineAtMs,
      now: Date.now,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(cancellationTimer);
    port.off("message", onParentMessage);
  }
  if (prepared === null) {
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }
  captureIntent(parsed.data.storeRoot, parsed.data.payload, Date.now);

  port.once("message", (message: unknown) => {
    if (!recordMessageSchema.safeParse(message).success) {
      port.postMessage({ kind: "recordFailed" });
      port.close();
      return;
    }
    try {
      appendTaskKickoffEvent({ root: parsed.data.storeRoot }, prepared.event);
      port.postMessage({ kind: "recorded" });
    } catch {
      port.postMessage({ kind: "recordFailed" });
    } finally {
      port.close();
    }
  });
  port.postMessage({ kind: "ready", ...prepared });
}

if (!isMainThread) await runTaskKickoffWorker();
