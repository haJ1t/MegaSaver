import { type ChunkSetSummary, listChunkSets } from "@megasaver/content-store";
import type { CoreRegistry, MemoryEntry } from "@megasaver/core";
import type { SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type RecallToolEnv = { registry: CoreRegistry; storeRoot: string };

const recallInputSchema = z
  .object({
    sessionId: z.string().min(1),
    intent: z.string(),
    maxBytes: z.number().int().positive().optional(),
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
  const { sessionId, intent } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_recall requires a non-empty intent");
  }

  const session = env.registry.getSession(sessionId as SessionId);
  if (session === null) {
    throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
  }

  // ponytail: in-process path only. The daemon /recall returns overlay stats events
  // ({records} with label/summary/score) — a fundamentally different shape from this
  // tool's registry-backed {memory, chunkSets}. Forwarding would silently change the
  // output contract and break callers. Deferred until the daemon exposes a
  // registry-backed recall route.
  const allMemory = env.registry.listMemoryEntries(session.projectId);
  const memory = allMemory.filter(
    (m) => m.approval === "approved" && (m.sessionId === session.id || m.scope === "project"),
  );
  const chunkSets = await listChunkSets({
    storeRoot: env.storeRoot,
    projectId: session.projectId,
    sessionId: session.id,
  });

  return { memory, chunkSets };
}
