import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import type { Project } from "@megasaver/core";
import { countTokens } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import type { TaskKickoffEvent } from "@megasaver/stats";
import { z } from "zod";
import { buildProjectContextPack } from "../commands/context/shared.js";
import { ensureStoreReady } from "../store.js";
import { renderTaskKickoffPack } from "./task-kickoff-pack.js";
import {
  type TaskKickoffStoreDependencies,
  hasTaskKickoffSessionClaim,
  isSafeHookSessionId,
  prepareTaskKickoffStorage,
} from "./task-kickoff-store.js";

const DEFAULT_DEADLINE_MS = 500;
export const TASK_KICKOFF_CANCELLATION_GRACE_MS = 50;
const MAX_CO_CHANGE_COMMITS = 1_000;
const taskKickoffPayloadSchema = z
  .object({
    prompt: z.string(),
    cwd: z.string(),
    session_id: z.string(),
  })
  .strip();

export type BuildTaskKickoffHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  deadlineMs?: number;
  deadlineAtMs?: number;
  signal?: AbortSignal;
  count?: (text: string) => Promise<number>;
  newId?: () => string;
  platform?: NodeJS.Platform;
  storeDependencies?: Partial<TaskKickoffStoreDependencies>;
};

export type PreparedTaskKickoff = {
  envelope: string;
  event: TaskKickoffEvent;
};

export function canonicalPathContains(rootPath: string, cwd: string): boolean {
  if (cwd === rootPath) return true;
  const descendantPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  return cwd.startsWith(descendantPrefix);
}

async function findTaskKickoffProjectByCwd(
  projects: readonly Project[],
  cwd: string,
): Promise<Project | null> {
  let resolvedCwd: string;
  try {
    resolvedCwd = await realpath(cwd);
  } catch {
    return null;
  }

  const candidates = await Promise.all(
    projects.map(async (project) => {
      try {
        return { project, resolvedRoot: await realpath(project.rootPath) };
      } catch {
        return null;
      }
    }),
  );
  return (
    candidates
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null && canonicalPathContains(candidate.resolvedRoot, resolvedCwd),
      )
      .sort(
        (left, right) =>
          right.resolvedRoot.length - left.resolvedRoot.length ||
          right.project.rootPath.length - left.project.rootPath.length ||
          left.project.rootPath.localeCompare(right.project.rootPath),
      )[0]?.project ?? null
  );
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
  deadlineAtMs: number,
  cancellationSignal?: AbortSignal,
): Promise<T | null> {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0 || cancellationSignal?.aborted === true) return null;
  const controller = new AbortController();
  const rejectionSafeWork = Promise.resolve()
    .then(() => work(controller.signal))
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeCancellationListener: (() => void) | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, remainingMs);
  });
  const cancellation = new Promise<null>((resolve) => {
    if (cancellationSignal === undefined) return;
    const abort = (): void => {
      controller.abort();
      resolve(null);
    };
    cancellationSignal.addEventListener("abort", abort, { once: true });
    removeCancellationListener = () => cancellationSignal.removeEventListener("abort", abort);
  });
  try {
    return await Promise.race([rejectionSafeWork, timeout, cancellation]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeCancellationListener?.();
  }
}

export async function prepareTaskKickoff(
  input: BuildTaskKickoffHookInput,
): Promise<PreparedTaskKickoff | null> {
  try {
    const deadlineAtMs =
      input.deadlineAtMs ?? Date.now() + (input.deadlineMs ?? DEFAULT_DEADLINE_MS);
    const parsed = taskKickoffPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return null;
    const prompt = parsed.data.prompt.trim();
    const cancelled = (): boolean => input.signal?.aborted ?? false;
    const platform = input.platform ?? process.platform;
    if (
      deadlineAtMs <= Date.now() ||
      cancelled() ||
      platform === "win32" ||
      prompt === "" ||
      !isSafeHookSessionId(parsed.data.session_id)
    )
      return null;
    if (hasTaskKickoffSessionClaim(input.storeRoot, parsed.data.session_id)) return null;

    const deadlineRemaining = () => Math.max(0, deadlineAtMs - Date.now());
    const redactedPrompt = redact(prompt).redacted;
    const nowMs = input.now();
    const nowIso = new Date(nowMs).toISOString();
    const ready = await renderBeforeDeadline(
      async () => ensureStoreReady(input.storeRoot),
      deadlineAtMs,
      input.signal,
    );
    if (ready === null || deadlineRemaining() <= 0 || cancelled()) return null;
    const { registry } = ready;
    const project = await findTaskKickoffProjectByCwd(registry.listProjects(), parsed.data.cwd);
    if (project === null) return null;

    const workspaceKey = encodeWorkspaceKey(project.rootPath);
    if (deadlineRemaining() <= 0 || cancelled()) return null;

    const rendered = await renderBeforeDeadline(
      async (signal) => {
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
      },
      deadlineAtMs,
      input.signal,
    );
    if (rendered === null || deadlineRemaining() <= 0 || cancelled()) return null;

    const storage = await renderBeforeDeadline(
      (signal) =>
        prepareTaskKickoffStorage(input.storeRoot, workspaceKey, parsed.data.session_id, {
          platform,
          signal,
          ...(input.storeDependencies === undefined
            ? {}
            : { dependencies: input.storeDependencies }),
        }),
      deadlineAtMs,
      input.signal,
    );
    if (storage === null || deadlineRemaining() <= 0 || cancelled()) return null;

    const eventId = (input.newId ?? randomUUID)();
    const claimed = await renderBeforeDeadline(
      (signal) => storage.createSessionClaim({ workspaceKey, eventId, createdAt: nowIso }, signal),
      deadlineAtMs,
      input.signal,
    );
    if (claimed !== true) return null;
    if (deadlineRemaining() <= 0 || cancelled()) return null;

    const stored = await renderBeforeDeadline(
      (signal) =>
        storage.writePack(
          {
            taskHash: createHash("sha256").update(redactedPrompt).digest("hex"),
            text: rendered.text,
            tokenCount: rendered.tokenCount,
            createdAt: nowMs,
          },
          signal,
        ),
      deadlineAtMs,
      input.signal,
    );
    if (stored !== true) return null;
    if (deadlineRemaining() <= 0 || cancelled()) return null;

    return {
      envelope: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: rendered.text,
        },
      }),
      event: {
        id: eventId,
        workspaceKey,
        sessionId: parsed.data.session_id,
        createdAt: nowIso,
        tokenCount: rendered.tokenCount,
      },
    };
  } catch {
    return null;
  }
}

export async function buildTaskKickoffHookOutput(
  input: BuildTaskKickoffHookInput,
): Promise<string> {
  return (await prepareTaskKickoff(input))?.envelope ?? "";
}
