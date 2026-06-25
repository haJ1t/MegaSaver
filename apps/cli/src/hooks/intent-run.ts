import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";

const intentFileSchema = z.object({ prompt: z.string(), ts: z.number() });
const payloadSchema = z.object({ prompt: z.string(), cwd: z.string().min(1) });

export function intentFilePath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "session-intent.json");
}

export function readSessionIntent(storeRoot: string, workspaceKey: string): string | undefined {
  const path = intentFilePath(storeRoot, workspaceKey);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = intentFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return undefined;
    const prompt = parsed.data.prompt.trim();
    return prompt === "" ? undefined : prompt;
  } catch {
    return undefined;
  }
}

// Atomic write (tmp + rename): the file is read by a separate process (the saver
// hook / daemon); a reader must never see a half-written file.
function writeIntentFile(storeRoot: string, workspaceKey: string, prompt: string, ts: number): void {
  const path = intentFilePath(storeRoot, workspaceKey);
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
  writeIntentFile(storeRoot, encodeWorkspaceKey(parsed.data.cwd), prompt, now());
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
