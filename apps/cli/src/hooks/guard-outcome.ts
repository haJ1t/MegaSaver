import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  appendGuardEvent,
  normalizeCommand,
  readGuardState,
  writeGuardState,
} from "@megasaver/core";
import { redact } from "@megasaver/policy";
import { z } from "zod";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady } from "../store.js";

const AUTO_MUTE_STRIKES = 3;

const postToolUsePayloadSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.literal("Bash"),
    tool_input: z.object({ command: z.string() }).passthrough(),
    tool_response: z.unknown(),
  })
  .passthrough();

function responseText(toolResponse: unknown): string {
  if (typeof toolResponse === "string") return toolResponse;
  if (typeof toolResponse !== "object" || toolResponse === null) return "";
  const o = toolResponse as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const stdout = typeof o["stdout"] === "string" ? o["stdout"] : "";
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const stderr = typeof o["stderr"] === "string" ? o["stderr"] : "";
  return `${stdout}\n${stderr}`;
}

// Guard outcome labeling (spec §4.3): if a command warned this session is
// re-run, classify the override by overlap with the ORIGINAL failure's stored
// signatures. Best-effort by contract: NEVER throws, and returns before any
// registry read when the store has no guard/ dir (zero cost for non-guard
// users). Runs in runSaverHookFromProcess ABOVE buildSaverDecision — decide()
// early-returns on small outputs and failing re-runs are usually small.
export async function maybeRecordGuardOutcome(
  payload: unknown,
  storeRoot: string,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  try {
    if (!existsSync(join(storeRoot, "guard"))) return;
    const parsed = postToolUsePayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    const { session_id: sessionId, cwd } = parsed.data;
    // Same redact+normalize the hook applied when it stored the intercept
    // command, so the lookup matches without persisting a raw secret.
    const normalized = normalizeCommand(redact(parsed.data.tool_input.command).redacted);
    if (normalized === "") return;

    const { registry } = await ensureStoreReady(storeRoot);
    const project = findProjectByCwd(registry.listProjects(), cwd);
    if (project === null) return;
    const state = readGuardState(storeRoot, project.id);
    const session = state?.sessions[sessionId];
    if (state === null || state === undefined || session === undefined) return;

    const hit = Object.entries(session.intercepts).find(([, v]) => v.command === normalized);
    if (hit === undefined) return;
    const [interceptId, intercept] = hit;

    const output = responseText(parsed.data.tool_response);
    const outcome =
      intercept.signatures.length === 0
        ? "overridden"
        : intercept.signatures.some((sig) => output.includes(sig))
          ? "overridden-failed"
          : "overridden-ok";

    appendGuardEvent(
      { root: storeRoot },
      {
        type: "outcome",
        id: randomUUID(),
        projectId: project.id,
        sessionId,
        interceptId,
        outcome,
        createdAt: now(),
      },
    );

    const intercepts = { ...session.intercepts };
    delete intercepts[interceptId];
    const candidateId = intercept.candidateId;
    let autoMuted = state.autoMuted;
    let mutedIds = state.mutedIds;
    if (outcome === "overridden-ok" && candidateId !== "") {
      const strikes = (state.autoMuted[candidateId] ?? 0) + 1;
      autoMuted = { ...state.autoMuted, [candidateId]: strikes };
      if (strikes >= AUTO_MUTE_STRIKES && !mutedIds.includes(candidateId)) {
        mutedIds = [...mutedIds, candidateId];
      }
    }
    writeGuardState(storeRoot, project.id, {
      ...state,
      mutedIds,
      autoMuted,
      sessions: { ...state.sessions, [sessionId]: { ...session, intercepts } },
    });
  } catch {
    // Swallow — best-effort; the saver's compression path is untouchable.
  }
}
