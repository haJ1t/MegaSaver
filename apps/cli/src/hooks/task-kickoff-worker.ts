import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { appendTaskKickoffEvent } from "@megasaver/stats";
import { z } from "zod";
import { captureIntent } from "./intent-run.js";
import { prepareTaskKickoff } from "./task-kickoff.js";

const taskKickoffWorkerDataSchema = z
  .object({
    payload: z.unknown(),
    storeRoot: z.string().min(1),
    deadlineMs: z.number().finite().positive().max(500),
  })
  .strict();
const recordMessageSchema = z.object({ kind: z.literal("record") }).strict();

export async function runTaskKickoffWorker(): Promise<void> {
  if (parentPort === null) return;
  const port = parentPort;
  const parsed = taskKickoffWorkerDataSchema.safeParse(workerData);
  if (!parsed.success) {
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }

  const deadlineAt = performance.now() + parsed.data.deadlineMs;
  captureIntent(parsed.data.storeRoot, parsed.data.payload, Date.now);
  const remainingMs = deadlineAt - performance.now();
  if (remainingMs <= 0) {
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }
  const prepared = await prepareTaskKickoff({
    payload: parsed.data.payload,
    storeRoot: parsed.data.storeRoot,
    deadlineMs: remainingMs,
    now: Date.now,
  });
  if (prepared === null) {
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }

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
