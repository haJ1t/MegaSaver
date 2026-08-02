import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { taskKickoffDeadlineAtMs } from "./task-kickoff-deadline.js";
import { TASK_KICKOFF_DEADLINE_MS, runTaskKickoffProcess } from "./task-kickoff-process.js";

const intentFileSchema = z.object({ prompt: z.string(), ts: z.number() });
const payloadSchema = z.object({
  prompt: z.string(),
  cwd: z.string().min(1),
  // Claude Code sends session_id on every hook event; optional so old/other
  // harness payloads keep working through the legacy file.
  session_id: z.string().min(1).optional(),
});

export const INTENT_TTL_MS = 30 * 60_000;
export const MAX_INTENT_HOOK_STDIN_BYTES = 256 * 1024;

// session_id becomes a filesystem segment; reject anything that could carry a
// path separator or dot-prefix (daemon safeSegmentSchema posture). A rejected
// id silently degrades to the legacy workspace file.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type CapturableIntent = {
  prompt: string;
  cwd: string;
  sessionId: string | undefined;
  workspaceKey: string;
};

function parseCapturableIntent(payload: unknown): CapturableIntent | undefined {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  const prompt = parsed.data.prompt.trim();
  if (prompt === "") return undefined;
  return {
    prompt,
    cwd: parsed.data.cwd,
    sessionId: parsed.data.session_id,
    workspaceKey: encodeWorkspaceKey(parsed.data.cwd),
  };
}

export function intentWorkspaceKeyForPayload(payload: unknown): string | undefined {
  return parseCapturableIntent(payload)?.workspaceKey;
}

export function intentFilePath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "session-intent.json");
}

export function sessionIntentFilePath(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
): string {
  return join(storeRoot, "stats", workspaceKey, "intent", `${sessionId}.json`);
}

function readIntentAt(path: string, now: () => number): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = intentFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return undefined;
    // D17: a stale prompt ranking a fresh read is worse than no intent at all.
    if (now() - parsed.data.ts > INTENT_TTL_MS) return undefined;
    const prompt = parsed.data.prompt.trim();
    return prompt === "" ? undefined : prompt;
  } catch {
    return undefined;
  }
}

export function readSessionIntent(
  storeRoot: string,
  workspaceKey: string,
  sessionId?: string,
  now: () => number = Date.now,
): string | undefined {
  if (sessionId !== undefined && SAFE_SEGMENT.test(sessionId)) {
    const scoped = readIntentAt(sessionIntentFilePath(storeRoot, workspaceKey, sessionId), now);
    if (scoped !== undefined) return scoped;
  }
  return readIntentAt(intentFilePath(storeRoot, workspaceKey), now);
}

// Atomic write (tmp + rename): the file is read by a separate process (the saver
// hook / daemon); a reader must never see a half-written file.
function writeIntentAt(path: string, prompt: string, ts: number): void {
  const dir = dirname(path);
  // Owner-only: this file holds the user's verbatim prompt. The chmod is the
  // backstop — mkdir's mode is a no-op on a dir that already exists.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify({ prompt, ts })}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Parse payload, derive the SAME workspaceKey the saver hook reads with
// (encodeWorkspaceKey(cwd)), write latest-wins. Exported for tests.
export function captureIntent(
  storeRoot: string,
  payload: unknown,
  now: () => number = Date.now,
): void {
  const intent = parseCapturableIntent(payload);
  if (intent === undefined) return;
  // Redact secrets before persisting — a user may paste an API key into a prompt;
  // the sibling tool-output path (context-gate record-output.ts) redacts the same way.
  const redacted = redact(intent.prompt).redacted;
  const ts = now();
  const sid = intent.sessionId;
  if (sid !== undefined && SAFE_SEGMENT.test(sid)) {
    writeIntentAt(sessionIntentFilePath(storeRoot, intent.workspaceKey, sid), redacted, ts);
  }
  // Legacy latest-wins file: id-less payloads and older saver binaries.
  writeIntentAt(intentFilePath(storeRoot, intent.workspaceKey), redacted, ts);
}

function readStdinSync(): string | undefined {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_INTENT_HOOK_STDIN_BYTES) {
      const capacity = Math.min(8192, MAX_INTENT_HOOK_STDIN_BYTES - total + 1);
      const chunk = Buffer.allocUnsafe(capacity);
      const read = readSync(0, chunk, 0, capacity, null);
      if (read === 0) return Buffer.concat(chunks, total).toString("utf8");
      total += read;
      if (total > MAX_INTENT_HOOK_STDIN_BYTES) return undefined;
      chunks.push(chunk.subarray(0, read));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// The command Claude Code's UserPromptSubmit hook invokes. ALWAYS exits 0; on any
// failure writes nothing so the prompt is never blocked. Wired by `mega hooks install`.
export async function runIntentHookFromProcess(storeFlag?: string): Promise<void> {
  const deadlineAtMs = taskKickoffDeadlineAtMs(TASK_KICKOFF_DEADLINE_MS);
  process.exitCode = 0;
  try {
    const input = readStdinSync();
    if (input === undefined) return;
    const raw = input.trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    await runTaskKickoffProcess({
      payload,
      storeRoot,
      deadlineAtMs,
    });
  } catch {
    // best-effort; never block the prompt.
  }
}
