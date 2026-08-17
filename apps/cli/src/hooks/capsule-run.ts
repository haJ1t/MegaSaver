import { readFileSync } from "node:fs";
import { atomicWriteFile, listOverlayChunkSets } from "@megasaver/content-store";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  type WorkStateCapsule,
  buildWorkStateCapsule,
  capsulePath,
  redactCapsule,
} from "./capsule.js";
import { SAFE_SEGMENT, readLatestIntentRecord } from "./intent-run.js";

const preCompactPayloadSchema = z
  .object({
    session_id: z.string().min(1),
    cwd: z.string().min(1),
    trigger: z.string().optional(),
  })
  .passthrough();

export type RunCapsuleHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  list: typeof listOverlayChunkSets;
};

// Snapshot core, extracted for tests. Contract: NEVER throws — a crashing
// PreCompact hook would stall every compaction (spec: fail-open, never block).
export async function runCapsuleHook(input: RunCapsuleHookInput): Promise<WorkStateCapsule | null> {
  try {
    const parsed = preCompactPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return null;
    const sessionId = parsed.data.session_id;
    if (!SAFE_SEGMENT.test(sessionId)) return null;
    const workspaceKey = encodeWorkspaceKey(parsed.data.cwd);
    const summaries = await input.list({
      storeRoot: input.storeRoot,
      workspaceKey,
      liveSessionId: sessionId,
    });
    const intent = readLatestIntentRecord(input.storeRoot, workspaceKey, sessionId);
    const capsule = redactCapsule(
      buildWorkStateCapsule({
        summaries,
        ...(intent !== undefined ? { intent } : {}),
        trigger: parsed.data.trigger ?? "unknown",
        now: input.now,
      }),
      (s) => redact(s).redacted,
    );
    atomicWriteFile(
      capsulePath(input.storeRoot, workspaceKey, sessionId),
      `${JSON.stringify(capsule, null, 2)}\n`,
    );
    return capsule;
  } catch {
    return null;
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0, never writes stdout (PreCompact stdout is ignored by Claude
// Code; emitting a decision object could block compaction — never do that).
export async function runCapsuleHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    await runCapsuleHook({
      payload,
      storeRoot,
      now: () => Date.now(),
      list: listOverlayChunkSets,
    });
  } catch {
    // Swallow — fail-open.
  }
}
