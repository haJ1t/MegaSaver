import { type ChunkSetSummary, listChunkSets } from "@megasaver/content-store";
import { type CoreRegistry, type MemoryEntry, isRecallable } from "@megasaver/core";
import type { SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { forwardOrFallback } from "./forward.js";

export type RecallToolEnv = { registry: CoreRegistry; storeRoot: string };

const recallInputSchema = z
  .object({
    sessionId: z.string().min(1),
    intent: z.string(),
    maxBytes: z.number().int().positive().optional(),
    // Bi-temporal time-travel: recall what we believed as of this instant.
    // Absent ⇒ now ⇒ currently-valid memories only.
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type RecallToolResult = {
  memory: readonly MemoryEntry[];
  chunkSets: readonly ChunkSetSummary[];
};

export async function handleRecall(
  env: RecallToolEnv,
  rawArgs: unknown,
): Promise<RecallToolResult> {
  const parsed = recallInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { sessionId, intent, asOf } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_recall requires a non-empty intent");
  }

  const at = asOf ?? new Date().toISOString();

  return forwardOrFallback(
    env.storeRoot,
    "/recall-registry",
    { sessionId, intent, ...(asOf !== undefined ? { asOf } : {}) },
    async () => {
      const session = env.registry.getSession(sessionId as SessionId);
      if (session === null) {
        throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
      }

      const allMemory = env.registry.listMemoryEntries(session.projectId);
      const memory = allMemory.filter(
        (m) => isRecallable(m, at) && (m.sessionId === session.id || m.scope === "project"),
      );
      const chunkSets = await listChunkSets({
        storeRoot: env.storeRoot,
        projectId: session.projectId,
        sessionId: session.id,
      });

      return { memory, chunkSets };
    },
  );
}
