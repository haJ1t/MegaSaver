import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { countTokens } from "@megasaver/output-filter";
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import type { TaskKickoffEvent } from "@megasaver/stats";
import { z } from "zod";
import { buildProjectContextPack } from "../commands/context/shared.js";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady } from "../store.js";
import { renderTaskKickoffPack } from "./task-kickoff-pack.js";
import {
  createTaskKickoffSessionClaim,
  hasTaskKickoffSessionClaim,
  isSafeHookSessionId,
  writeTaskKickoffPack,
} from "./task-kickoff-store.js";

const DEFAULT_DEADLINE_MS = 500;
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
  count?: (text: string) => Promise<number>;
  newId?: () => string;
};

export type PreparedTaskKickoff = {
  envelope: string;
  event: TaskKickoffEvent;
};

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

export async function prepareTaskKickoff(
  input: BuildTaskKickoffHookInput,
): Promise<PreparedTaskKickoff | null> {
  try {
    const startedAt = performance.now();
    const deadlineMs = input.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const parsed = taskKickoffPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return null;
    const prompt = parsed.data.prompt.trim();
    if (deadlineMs <= 0 || prompt === "" || !isSafeHookSessionId(parsed.data.session_id))
      return null;
    if (hasTaskKickoffSessionClaim(input.storeRoot, parsed.data.session_id)) return null;

    const remainingMs = () => Math.max(0, deadlineMs - (performance.now() - startedAt));
    const redactedPrompt = redact(prompt).redacted;
    const nowMs = input.now();
    const nowIso = new Date(nowMs).toISOString();
    const ready = await renderBeforeDeadline(
      async () => ensureStoreReady(input.storeRoot),
      remainingMs(),
    );
    if (ready === null || remainingMs() <= 0) return null;
    const { registry } = ready;
    const project = findProjectByCwd(registry.listProjects(), parsed.data.cwd);
    if (project === null) return null;

    const workspaceKey = encodeWorkspaceKey(project.rootPath);
    if (remainingMs() <= 0) return null;

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
    if (rendered === null || remainingMs() <= 0) return null;

    const eventId = (input.newId ?? randomUUID)();
    const claimed = await renderBeforeDeadline(
      (signal) =>
        createTaskKickoffSessionClaim(
          input.storeRoot,
          parsed.data.session_id,
          { workspaceKey, eventId, createdAt: nowIso },
          signal,
        ),
      remainingMs(),
    );
    if (claimed !== true) return null;
    if (remainingMs() <= 0) return null;

    try {
      writeTaskKickoffPack(input.storeRoot, workspaceKey, parsed.data.session_id, {
        taskHash: createHash("sha256").update(redactedPrompt).digest("hex"),
        text: rendered.text,
        tokenCount: rendered.tokenCount,
        createdAt: nowMs,
      });
    } catch {
      return null;
    }
    if (remainingMs() <= 0) return null;

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
