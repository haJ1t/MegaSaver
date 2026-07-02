import type { ContextPack } from "@megasaver/context-pruner";
import { deriveIntent } from "@megasaver/retrieval";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { type ContextToolEnv, packFor } from "./context-pruning.js";

export type GetTaskContextEnv = ContextToolEnv;

const argsSchema = z.object({ projectId: z.string().min(1), task: z.string().trim().min(1) });

// Proactive seam: turn a free-text task into a task-scoped context pack. The
// task is normalized through deriveIntent (explicit source), then packFor does
// the project lookup, index read, and pack build — same pipeline (and same
// ContextPack shape) as get_relevant_context, so callers get one type.
export async function handleGetTaskContext(
  env: GetTaskContextEnv,
  args: unknown,
): Promise<ContextPack> {
  const parsed = argsSchema.safeParse(args);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const intent = deriveIntent({ intent: parsed.data.task });
  return packFor(env, { projectId: parsed.data.projectId, task: intent.query });
}
