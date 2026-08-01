import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { countTokens } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { appendTaskKickoffEvent } from "@megasaver/stats";
import { z } from "zod";
import { buildProjectContextPack } from "../commands/context/shared.js";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady } from "../store.js";
import { renderTaskKickoffPack } from "./task-kickoff-pack.js";
import {
  isSafeHookSessionId,
  readTaskKickoffPack,
  removeTaskKickoffPack,
  taskKickoffPackPath,
  writeTaskKickoffPack,
} from "./task-kickoff-store.js";

const DEFAULT_DEADLINE_MS = 500;
const LOCK_POLL_MS = 5;
const LOCK_STALE_MS = 5_000;
const MAX_CO_CHANGE_COMMITS = 1_000;
const taskKickoffPayloadSchema = z
  .object({
    prompt: z.string(),
    cwd: z.string(),
    session_id: z.string(),
  })
  .strict();

export type BuildTaskKickoffHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  deadlineMs?: number;
  count?: (text: string) => Promise<number>;
  newId?: () => string;
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function waitForLock(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function acquireSessionLock(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  deadlineMs: number,
): Promise<(() => Promise<void>) | null> {
  if (deadlineMs <= 0) return null;
  const lockPath = `${taskKickoffPackPath(storeRoot, workspaceKey, sessionId)}.lock`;
  const directory = dirname(lockPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const deadline = performance.now() + deadlineMs;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return async () => {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    try {
      const observed = await stat(lockPath);
      if (observed.mtimeMs < Date.now() - LOCK_STALE_MS) {
        const current = await stat(lockPath);
        if (current.mtimeMs === observed.mtimeMs) await rm(lockPath, { force: true });
        continue;
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }

    const remaining = deadline - performance.now();
    if (remaining <= 0) return null;
    await waitForLock(Math.min(LOCK_POLL_MS, remaining));
  }
}

function readCoChangeLogAsync(cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(
        "git",
        ["log", `--max-count=${MAX_CO_CHANGE_COMMITS}`, "--numstat", "--format=%n"],
        {
          cwd,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          signal,
          windowsHide: true,
        },
        (error, stdout) => resolve(error === null ? stdout : ""),
      );
    } catch {
      resolve("");
    }
  });
}

async function renderBeforeDeadline<T>(
  work: (signal: AbortSignal) => Promise<T | null>,
  deadlineMs: number,
): Promise<T | null> {
  if (deadlineMs <= 0) return null;
  const controller = new AbortController();
  const rejectionSafeWork = Promise.resolve()
    .then(() => work(controller.signal))
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, deadlineMs);
  });
  try {
    return await Promise.race([rejectionSafeWork, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function buildTaskKickoffHookOutput(
  input: BuildTaskKickoffHookInput,
): Promise<string> {
  try {
    const startedAt = performance.now();
    const deadlineMs = input.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const parsed = taskKickoffPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const prompt = parsed.data.prompt.trim();
    if (deadlineMs <= 0 || prompt === "" || !isSafeHookSessionId(parsed.data.session_id)) return "";

    const redactedPrompt = redact(prompt).redacted;
    const nowMs = input.now();
    const nowIso = new Date(nowMs).toISOString();
    const { registry } = await ensureStoreReady(input.storeRoot);
    const project = findProjectByCwd(registry.listProjects(), parsed.data.cwd);
    if (project === null) return "";

    const workspaceKey = encodeWorkspaceKey(project.rootPath);
    if (readTaskKickoffPack(input.storeRoot, workspaceKey, parsed.data.session_id) !== undefined) {
      return "";
    }

    const remainingMs = () => Math.max(0, deadlineMs - (performance.now() - startedAt));
    const releaseLock = await acquireSessionLock(
      input.storeRoot,
      workspaceKey,
      parsed.data.session_id,
      remainingMs(),
    );
    if (releaseLock === null) return "";
    try {
      if (
        readTaskKickoffPack(input.storeRoot, workspaceKey, parsed.data.session_id) !== undefined
      ) {
        return "";
      }

      const rendered = await renderBeforeDeadline(async (signal) => {
        const coChangeLog = await readCoChangeLogAsync(project.rootPath, signal);
        if (signal.aborted) return null;
        const contextPack = await buildProjectContextPack({
          project,
          registry,
          rootDir: input.storeRoot,
          task: redactedPrompt,
          coChangeLog,
        });
        if (contextPack === null || signal.aborted) return null;
        return renderTaskKickoffPack({
          projectName: project.name,
          task: redactedPrompt,
          now: nowIso,
          memories: registry.listMemoryEntries(project.id),
          contextPack,
          count: input.count ?? countTokens,
        });
      }, remainingMs());
      if (rendered === null) return "";

      writeTaskKickoffPack(input.storeRoot, workspaceKey, parsed.data.session_id, {
        taskHash: createHash("sha256").update(redactedPrompt).digest("hex"),
        text: rendered.text,
        tokenCount: rendered.tokenCount,
        createdAt: nowMs,
      });
      try {
        appendTaskKickoffEvent(
          { root: input.storeRoot },
          {
            id: (input.newId ?? randomUUID)(),
            workspaceKey,
            sessionId: parsed.data.session_id,
            createdAt: nowIso,
            tokenCount: rendered.tokenCount,
          },
        );
      } catch {
        removeTaskKickoffPack(input.storeRoot, workspaceKey, parsed.data.session_id);
        return "";
      }
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: rendered.text,
        },
      });
    } finally {
      await releaseLock();
    }
  } catch {
    return "";
  }
}
