import { createHash, randomUUID } from "node:crypto";
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
  writeTaskKickoffPack,
} from "./task-kickoff-store.js";

const DEFAULT_DEADLINE_MS = 500;
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

async function renderBeforeDeadline<T>(
  work: Promise<T | null>,
  deadlineMs: number,
): Promise<T | null> {
  const rejectionSafeWork = work.catch(() => null);
  if (deadlineMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
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
    const parsed = taskKickoffPayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const prompt = parsed.data.prompt.trim();
    if (prompt === "" || !isSafeHookSessionId(parsed.data.session_id)) return "";

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

    const rendered = await renderBeforeDeadline(
      (async () => {
        const contextPack = await buildProjectContextPack({
          project,
          registry,
          rootDir: input.storeRoot,
          task: redactedPrompt,
        });
        if (contextPack === null) return null;
        return renderTaskKickoffPack({
          projectName: project.name,
          task: redactedPrompt,
          now: nowIso,
          memories: registry.listMemoryEntries(project.id),
          contextPack,
          count: input.count ?? countTokens,
        });
      })(),
      input.deadlineMs ?? DEFAULT_DEADLINE_MS,
    );
    if (rendered === null) return "";

    writeTaskKickoffPack(input.storeRoot, workspaceKey, parsed.data.session_id, {
      taskHash: createHash("sha256").update(redactedPrompt).digest("hex"),
      text: rendered.text,
      tokenCount: rendered.tokenCount,
      createdAt: nowMs,
    });
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
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: rendered.text,
      },
    });
  } catch {
    return "";
  }
}
