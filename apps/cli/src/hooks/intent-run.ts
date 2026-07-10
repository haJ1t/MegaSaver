import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";

const intentFileSchema = z.object({ prompt: z.string(), ts: z.number() });
const payloadSchema = z.object({
  prompt: z.string(),
  cwd: z.string().min(1),
  // Claude Code sends session_id on every hook event; optional so old/other
  // harness payloads keep working through the legacy file.
  session_id: z.string().min(1).optional(),
});

export const INTENT_TTL_MS = 30 * 60_000;

// session_id becomes a filesystem segment; reject anything that could carry a
// path separator or dot-prefix (daemon safeSegmentSchema posture). A rejected
// id silently degrades to the legacy workspace file.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify({ prompt, ts })}\n`);
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
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return;
  const prompt = parsed.data.prompt.trim();
  if (prompt === "") return;
  const wsKey = encodeWorkspaceKey(parsed.data.cwd);
  // Redact secrets before persisting — a user may paste an API key into a prompt;
  // the sibling tool-output path (context-gate record-output.ts) redacts the same way.
  const redacted = redact(prompt).redacted;
  const ts = now();
  const sid = parsed.data.session_id;
  if (sid !== undefined && SAFE_SEGMENT.test(sid)) {
    writeIntentAt(sessionIntentFilePath(storeRoot, wsKey, sid), redacted, ts);
  }
  // Legacy latest-wins file: id-less payloads and older saver binaries.
  writeIntentAt(intentFilePath(storeRoot, wsKey), redacted, ts);
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// The command Claude Code's UserPromptSubmit hook invokes. ALWAYS exits 0; on any
// failure writes nothing so the prompt is never blocked. Wired by `mega hooks install`.
export function runIntentHookFromProcess(): void {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    captureIntent(storeRoot, payload);
  } catch {
    // best-effort; never block the prompt.
  }
}
