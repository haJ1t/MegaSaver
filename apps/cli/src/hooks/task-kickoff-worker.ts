import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { z } from "zod";
import { captureIntent, intentWorkspaceKeyForPayload } from "./intent-run.js";
import {
  normalizeTaskKickoffStoreRoot,
  prepareTaskKickoffIntentCapture,
  prepareTaskKickoffStoreRoot,
} from "./task-kickoff-store.js";
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

async function capturePreparedIntent(
  storeRoot: string,
  payload: unknown,
  prepared: Promise<boolean>,
  deadlineAtMs: number,
): Promise<void> {
  if (!(await prepared)) return;
  if (deadlineAtMs <= Date.now()) return;
  try {
    captureIntent(storeRoot, payload, Date.now);
  } catch {
    // Intent is advisory; Task Kickoff delivery and accounting stay independent.
  }
}

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
  const storeRoot = normalizeTaskKickoffStoreRoot(parsed.data.storeRoot);
  const rootPrepared = await prepareTaskKickoffStoreRoot(storeRoot);
  if (!rootPrepared || parsed.data.deadlineAtMs <= Date.now()) {
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }
  const intentWorkspaceKey = intentWorkspaceKeyForPayload(parsed.data.payload);
  const intentPrepared =
    intentWorkspaceKey === undefined
      ? Promise.resolve(false)
      : prepareTaskKickoffIntentCapture(storeRoot, intentWorkspaceKey);
  const intentCapture = capturePreparedIntent(
    storeRoot,
    parsed.data.payload,
    intentPrepared,
    parsed.data.deadlineAtMs,
  );
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
      storeRoot,
      deadlineAtMs: parsed.data.deadlineAtMs,
      now: Date.now,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(cancellationTimer);
    port.off("message", onParentMessage);
  }
  if (prepared === null) {
    await intentCapture;
    port.postMessage({ kind: "done" });
    port.close();
    return;
  }
  port.once("message", (message: unknown) => {
    void (async () => {
      if (!recordMessageSchema.safeParse(message).success) {
        await intentCapture;
        port.postMessage({ kind: "intentDone" });
        port.close();
        return;
      }
      await intentCapture;
      port.postMessage({ kind: "intentDone" });
      port.close();
    })();
  });
  port.postMessage({ kind: "ready", ...prepared });
}

if (!isMainThread) await runTaskKickoffWorker();
